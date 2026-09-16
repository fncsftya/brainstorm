package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/joho/godotenv"
	_ "modernc.org/sqlite"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const maxHTMLBytes = 2 * 1024 * 1024
const maxImageBytes = 2 * 1024 * 1024
const maxRedirects = 15

const sessionCookieName = "brainstorm_session"
const oauthStateCookieName = "brainstorm_oauth_state"
const oauthRedirectCookieName = "brainstorm_oauth_redirect"

var errTooManyRedirects = fmt.Errorf("too many redirects")
var idSanitizeRe = regexp.MustCompile(`[^a-z0-9_-]+`)

const sessionTTL = 14 * 24 * time.Hour

type metadataResponse struct {
	Title    string `json:"title"`
	ImageURL string `json:"imageUrl"`
	Hostname string `json:"hostname"`
}

type server struct {
	db                *sql.DB
	oauthConfig       *oauth2.Config
	oauthEnabled      bool
	openRouterKey     string
	openRouterModel   string
	openRouterAppName string
	openRouterReferer string
	openRouterEnabled bool
}

type user struct {
	ID        int64  `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
	Premium   bool   `json:"premium"`
}

type brainstormRequest struct {
	Idea string `json:"idea"`
}

type brainstormNote struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type brainstormConnection struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label,omitempty"`
}

type brainstormResponse struct {
	Notes       []brainstormNote       `json:"notes"`
	Connections []brainstormConnection `json:"connections"`
}

type openRouterMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openRouterResponseFormat struct {
	Type       string                   `json:"type"`
	JSONSchema openRouterResponseSchema `json:"json_schema,omitempty"`
}

type openRouterResponseSchema struct {
	Name   string                 `json:"name"`
	Strict bool                   `json:"strict"`
	Schema map[string]interface{} `json:"schema"`
}

type openRouterPlugin struct {
	ID string `json:"id"`
}

type openRouterRequest struct {
	Model          string                    `json:"model"`
	Messages       []openRouterMessage       `json:"messages"`
	MaxTokens      int                       `json:"max_tokens,omitempty"`
	Temperature    float64                   `json:"temperature,omitempty"`
	ResponseFormat *openRouterResponseFormat `json:"response_format,omitempty"`
	Plugins        []openRouterPlugin        `json:"plugins,omitempty"`
}

type openRouterChoice struct {
	Message openRouterMessage `json:"message"`
}

type openRouterResponse struct {
	Choices []openRouterChoice `json:"choices"`
}

type googleUserInfo struct {
	Sub     string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	root := flag.String("root", "public", "path to static files")
	dbPath := flag.String("db", "brainstorm.db", "path to sqlite db")
	flag.Parse()

	_ = godotenv.Load()

	db, err := sql.Open("sqlite", *dbPath)
	if err != nil {
		log.Fatal(err)
	}
	if err := initDB(db); err != nil {
		log.Fatal(err)
	}

	oauthConfig, oauthEnabled := loadOAuthConfig()
	openRouterKey, openRouterModel, openRouterReferer, openRouterAppName, openRouterEnabled := loadOpenRouterConfig()
	srv := &server{
		db:                db,
		oauthConfig:       oauthConfig,
		oauthEnabled:      oauthEnabled,
		openRouterKey:     openRouterKey,
		openRouterModel:   openRouterModel,
		openRouterReferer: openRouterReferer,
		openRouterAppName: openRouterAppName,
		openRouterEnabled: openRouterEnabled,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/metadata", handleMetadata)
	mux.HandleFunc("/api/auth/google/login", srv.handleGoogleLogin)
	mux.HandleFunc("/api/auth/google/callback", srv.handleGoogleCallback)
	mux.HandleFunc("/api/auth/me", srv.handleAuthMe)
	mux.HandleFunc("/api/auth/logout", srv.handleLogout)
	mux.HandleFunc("/api/tools/brainstorm", srv.handleAIBrainstorm)
	mux.Handle("/", http.FileServer(http.Dir(*root)))

	log.Printf("Serving %s on %s", *root, *addr)
	log.Fatal(http.ListenAndServe(*addr, loggingMiddleware(mux)))
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func loadOAuthConfig() (*oauth2.Config, bool) {
	clientID := strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_SECRET"))
	if clientID == "" || clientSecret == "" {
		return nil, false
	}

	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     google.Endpoint,
		Scopes:       []string{"openid", "email", "profile"},
		RedirectURL:  strings.TrimSpace(os.Getenv("GOOGLE_REDIRECT_URL")),
	}, true
}

func loadOpenRouterConfig() (string, string, string, string, bool) {
	apiKey := strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY"))
	if apiKey == "" {
		return "", "", "", "", false
	}

	model := strings.TrimSpace(os.Getenv("OPENROUTER_MODEL"))
	if model == "" {
		model = "google/gemini-3-flash-preview"
	}

	referer := strings.TrimSpace(os.Getenv("OPENROUTER_HTTP_REFERER"))
	appName := strings.TrimSpace(os.Getenv("OPENROUTER_APP_NAME"))

	return apiKey, model, referer, appName, true
}

func initDB(db *sql.DB) error {
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return err
	}

	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_id TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL,
            name TEXT NOT NULL,
            avatar_url TEXT NOT NULL,
            premium INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login_at TEXT NOT NULL
        );`,
		`CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );`,
		`CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);`,
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return err
		}
	}

	if err := ensureUsersPremiumColumn(db); err != nil {
		return err
	}

	return nil
}

func (s *server) handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.oauthEnabled {
		http.Error(w, "oauth not configured", http.StatusServiceUnavailable)
		return
	}

	cfg := s.oauthConfigForRequest(r)
	if cfg == nil {
		http.Error(w, "oauth config error", http.StatusInternalServerError)
		return
	}

	state, err := randomToken(32)
	if err != nil {
		http.Error(w, "failed to generate state", http.StatusInternalServerError)
		return
	}

	redirect := sanitizeRedirect(r.URL.Query().Get("redirect"))
	secure := isSecureRequest(r)

	setCookie(w, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600,
	}, secure)

	setCookie(w, &http.Cookie{
		Name:     oauthRedirectCookieName,
		Value:    redirect,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600,
	}, secure)

	authURL := cfg.AuthCodeURL(state, oauth2.AccessTypeOnline)
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (s *server) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.oauthEnabled {
		http.Error(w, "oauth not configured", http.StatusServiceUnavailable)
		return
	}

	if errParam := r.URL.Query().Get("error"); errParam != "" {
		http.Error(w, "oauth error: "+errParam, http.StatusBadRequest)
		return
	}

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" || state == "" {
		http.Error(w, "missing oauth params", http.StatusBadRequest)
		return
	}

	secure := isSecureRequest(r)

	stateCookie, err := r.Cookie(oauthStateCookieName)
	if err != nil || stateCookie.Value != state {
		http.Error(w, "invalid oauth state", http.StatusBadRequest)
		return
	}

	clearCookie(w, oauthStateCookieName, secure)

	redirect := "/"
	if redirectCookie, err := r.Cookie(oauthRedirectCookieName); err == nil {
		redirect = sanitizeRedirect(redirectCookie.Value)
	}
	clearCookie(w, oauthRedirectCookieName, secure)

	cfg := s.oauthConfigForRequest(r)
	if cfg == nil {
		http.Error(w, "oauth config error", http.StatusInternalServerError)
		return
	}

	token, err := cfg.Exchange(r.Context(), code)
	if err != nil {
		http.Error(w, "oauth exchange failed", http.StatusBadRequest)
		return
	}

	info, err := fetchGoogleUserInfo(r.Context(), cfg, token)
	if err != nil {
		http.Error(w, "failed to fetch user info", http.StatusBadRequest)
		return
	}

	if info.Sub == "" {
		http.Error(w, "missing user id", http.StatusBadRequest)
		return
	}

	userRecord, err := s.upsertUser(r.Context(), info)
	if err != nil {
		http.Error(w, "failed to store user", http.StatusInternalServerError)
		return
	}

	sessionToken, expiresAt, err := s.createSession(r.Context(), userRecord.ID)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	setCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sessionToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
	}, secure)

	http.Redirect(w, r, redirect, http.StatusFound)
}

func (s *server) handleAuthMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.oauthEnabled {
		http.Error(w, "oauth not configured", http.StatusServiceUnavailable)
		return
	}

	userRecord, err := s.sessionUser(r)
	if err != nil || userRecord == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(userRecord)
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.oauthEnabled {
		http.Error(w, "oauth not configured", http.StatusServiceUnavailable)
		return
	}

	cookie, err := r.Cookie(sessionCookieName)
	if err == nil && cookie.Value != "" {
		_ = s.deleteSession(r.Context(), cookie.Value)
	}

	clearCookie(w, sessionCookieName, isSecureRequest(r))
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleAIBrainstorm(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.oauthEnabled {
		http.Error(w, "oauth not configured", http.StatusServiceUnavailable)
		return
	}
	if !s.openRouterEnabled {
		http.Error(w, "openrouter not configured", http.StatusServiceUnavailable)
		return
	}

	userRecord, err := s.sessionUser(r)
	if err != nil || userRecord == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !userRecord.Premium {
		http.Error(w, "premium required", http.StatusForbidden)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10*1024)
	var payload brainstormRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	idea := strings.TrimSpace(payload.Idea)
	if idea == "" {
		http.Error(w, "missing idea", http.StatusBadRequest)
		return
	}
	if len(idea) > 1000 {
		idea = idea[:1000]
	}

	result, err := s.generateBrainstorm(r.Context(), idea)
	if err != nil {
		log.Printf("ai brainstorm error: %v", err)
		http.Error(w, "ai brainstorm failed", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *server) oauthConfigForRequest(r *http.Request) *oauth2.Config {
	if s.oauthConfig == nil {
		return nil
	}

	cfg := *s.oauthConfig
	if cfg.RedirectURL == "" {
		cfg.RedirectURL = fmt.Sprintf("%s/api/auth/google/callback", requestBaseURL(r))
	}

	return &cfg
}

func (s *server) generateBrainstorm(ctx context.Context, idea string) (*brainstormResponse, error) {
	reqBody := openRouterRequest{
		Model: s.openRouterModel,
		Messages: []openRouterMessage{
			{
				Role:    "system",
				Content: brainstormSystemPrompt(idea),
			},
			{
				Role:    "user",
				Content: idea,
			},
		},
		MaxTokens:   900,
		Temperature: 0.7,
		ResponseFormat: &openRouterResponseFormat{
			Type: "json_schema",
			JSONSchema: openRouterResponseSchema{
				Name:   "brainstorm_graph",
				Strict: true,
				Schema: brainstormResponseSchema(),
			},
		},
		Plugins: []openRouterPlugin{{ID: "response-healing"}},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://openrouter.ai/api/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.openRouterKey)
	req.Header.Set("Content-Type", "application/json")
	if s.openRouterReferer != "" {
		req.Header.Set("HTTP-Referer", s.openRouterReferer)
	}
	if s.openRouterAppName != "" {
		req.Header.Set("X-Title", s.openRouterAppName)
	}

	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("openrouter status %s: %s", resp.Status, strings.TrimSpace(string(bodyBytes)))
	}

	var orResponse openRouterResponse
	if err := json.NewDecoder(resp.Body).Decode(&orResponse); err != nil {
		return nil, err
	}
	if len(orResponse.Choices) == 0 {
		return nil, fmt.Errorf("openrouter returned no choices")
	}

	content := extractJSONContent(orResponse.Choices[0].Message.Content)
	if content == "" {
		return nil, fmt.Errorf("empty model response")
	}

	var result brainstormResponse
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, err
	}

	sanitized := sanitizeBrainstormResponse(result)
	if len(sanitized.Notes) == 0 {
		return nil, fmt.Errorf("no notes returned")
	}

	return &sanitized, nil
}

func brainstormSystemPrompt(idea string) string {
	return fmt.Sprintf(`You are generating seed notes for a visual brainstorming canvas app. Each note is a short text idea and connections link related notes.

The user wants help brainstorming this topic:

<topic>
%s
</topic>

Return JSON only using the exact schema provided. Keep notes concise (1-2 short sentences max) and use clear, distinct ideas. Provide 8-14 notes and 6-16 connections. Connections should reference note ids and only link related ideas.`, idea)
}

func brainstormResponseSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"notes": map[string]interface{}{
				"type":     "array",
				"minItems": 4,
				"maxItems": 20,
				"items": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"id": map[string]interface{}{
							"type":      "string",
							"minLength": 1,
							"maxLength": 40,
						},
						"text": map[string]interface{}{
							"type":      "string",
							"minLength": 1,
							"maxLength": 160,
						},
					},
					"required":             []string{"id", "text"},
					"additionalProperties": false,
				},
			},
			"connections": map[string]interface{}{
				"type": "array",
				"items": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"from": map[string]interface{}{
							"type":      "string",
							"minLength": 1,
							"maxLength": 40,
						},
						"to": map[string]interface{}{
							"type":      "string",
							"minLength": 1,
							"maxLength": 40,
						},
						"label": map[string]interface{}{
							"type":      "string",
							"maxLength": 80,
						},
					},
					"required":             []string{"from", "to"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"notes", "connections"},
		"additionalProperties": false,
	}
}

func fetchGoogleUserInfo(ctx context.Context, cfg *oauth2.Config, token *oauth2.Token) (googleUserInfo, error) {
	client := cfg.Client(ctx, token)
	resp, err := client.Get("https://openidconnect.googleapis.com/v1/userinfo")
	if err != nil {
		return googleUserInfo{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return googleUserInfo{}, fmt.Errorf("userinfo status %s", resp.Status)
	}

	var info googleUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return googleUserInfo{}, err
	}

	return info, nil
}

func (s *server) upsertUser(ctx context.Context, info googleUserInfo) (*user, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	name := strings.TrimSpace(info.Name)
	if name == "" {
		name = strings.TrimSpace(info.Email)
	}

	_, err := s.db.ExecContext(ctx, `
        INSERT INTO users (google_id, email, name, avatar_url, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(google_id) DO UPDATE SET
            email = excluded.email,
            name = excluded.name,
            avatar_url = excluded.avatar_url,
            updated_at = excluded.updated_at,
            last_login_at = excluded.last_login_at
    `, info.Sub, info.Email, name, info.Picture, now, now, now)
	if err != nil {
		return nil, err
	}

	row := s.db.QueryRowContext(ctx, `
        SELECT id, email, name, avatar_url, premium
        FROM users
        WHERE google_id = ?
    `, info.Sub)

	var userRecord user
	var premiumInt int
	if err := row.Scan(&userRecord.ID, &userRecord.Email, &userRecord.Name, &userRecord.AvatarURL, &premiumInt); err != nil {
		return nil, err
	}
	userRecord.Premium = premiumInt != 0

	return &userRecord, nil
}

func (s *server) createSession(ctx context.Context, userID int64) (string, time.Time, error) {
	token, err := randomToken(48)
	if err != nil {
		return "", time.Time{}, err
	}

	now := time.Now().UTC()
	expiresAt := now.Add(sessionTTL)

	_, err = s.db.ExecContext(ctx, `
        INSERT INTO sessions (token, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
    `, token, userID, now.Format(time.RFC3339), expiresAt.Format(time.RFC3339))
	if err != nil {
		return "", time.Time{}, err
	}

	return token, expiresAt, nil
}

func (s *server) deleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token = ?`, token)
	return err
}

func (s *server) sessionUser(r *http.Request) (*user, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return nil, fmt.Errorf("missing session")
	}

	row := s.db.QueryRowContext(r.Context(), `
        SELECT u.id, u.email, u.name, u.avatar_url, u.premium, s.expires_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
    `, cookie.Value)

	var userRecord user
	var premiumInt int
	var expiresAt string
	if err := row.Scan(&userRecord.ID, &userRecord.Email, &userRecord.Name, &userRecord.AvatarURL, &premiumInt, &expiresAt); err != nil {
		return nil, err
	}
	userRecord.Premium = premiumInt != 0

	expires, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		_ = s.deleteSession(r.Context(), cookie.Value)
		return nil, err
	}

	if time.Now().UTC().After(expires) {
		_ = s.deleteSession(r.Context(), cookie.Value)
		return nil, fmt.Errorf("session expired")
	}

	return &userRecord, nil
}

func sanitizeRedirect(target string) string {
	if target == "" {
		return "/"
	}
	if strings.HasPrefix(target, "//") {
		return "/"
	}
	if strings.HasPrefix(target, "/") {
		return target
	}
	return "/"
}

func randomToken(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func extractJSONContent(content string) string {
	trimmed := strings.TrimSpace(content)
	if strings.HasPrefix(trimmed, "```") {
		trimmed = strings.TrimPrefix(trimmed, "```json")
		trimmed = strings.TrimPrefix(trimmed, "```")
		trimmed = strings.TrimSuffix(trimmed, "```")
		trimmed = strings.TrimSpace(trimmed)
	}
	return trimmed
}

func sanitizeBrainstormResponse(result brainstormResponse) brainstormResponse {
	maxNotes := 20
	maxConnections := 40
	notes := make([]brainstormNote, 0, len(result.Notes))
	seen := make(map[string]struct{})

	for _, note := range result.Notes {
		if len(notes) >= maxNotes {
			break
		}
		text := strings.TrimSpace(note.Text)
		if text == "" {
			continue
		}
		if len(text) > 160 {
			text = text[:160]
		}
		id := normalizeIdentifier(note.ID, fmt.Sprintf("note-%d", len(notes)+1), seen)
		notes = append(notes, brainstormNote{ID: id, Text: text})
	}

	validIDs := make(map[string]struct{}, len(notes))
	for _, note := range notes {
		validIDs[note.ID] = struct{}{}
	}

	connections := make([]brainstormConnection, 0, len(result.Connections))
	for _, conn := range result.Connections {
		if len(connections) >= maxConnections {
			break
		}
		from := strings.TrimSpace(conn.From)
		to := strings.TrimSpace(conn.To)
		if from == "" || to == "" || from == to {
			continue
		}
		if _, ok := validIDs[from]; !ok {
			continue
		}
		if _, ok := validIDs[to]; !ok {
			continue
		}
		label := strings.TrimSpace(conn.Label)
		if len(label) > 80 {
			label = label[:80]
		}
		connections = append(connections, brainstormConnection{From: from, To: to, Label: label})
	}

	return brainstormResponse{
		Notes:       notes,
		Connections: connections,
	}
}

func normalizeIdentifier(value string, fallback string, seen map[string]struct{}) string {
	base := strings.TrimSpace(value)
	if base == "" {
		base = fallback
	}
	base = strings.ToLower(base)
	base = idSanitizeRe.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = fallback
	}
	unique := base
	counter := 2
	for {
		if _, exists := seen[unique]; !exists {
			seen[unique] = struct{}{}
			return unique
		}
		unique = fmt.Sprintf("%s-%d", base, counter)
		counter++
	}
}

func requestBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		scheme = forwarded
	}

	return fmt.Sprintf("%s://%s", scheme, r.Host)
}

func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func setCookie(w http.ResponseWriter, cookie *http.Cookie, secure bool) {
	cookie.Secure = secure
	http.SetCookie(w, cookie)
}

func clearCookie(w http.ResponseWriter, name string, secure bool) {
	setCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	}, secure)
}

func ensureUsersPremiumColumn(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(users)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	hasPremium := false
	for rows.Next() {
		var cid int
		var name string
		var ctype string
		var notnull int
		var dfltValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk); err != nil {
			return err
		}
		if name == "premium" {
			hasPremium = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if hasPremium {
		return nil
	}

	_, err = db.Exec(`ALTER TABLE users ADD COLUMN premium INTEGER NOT NULL DEFAULT 0`)
	return err
}

func handleMetadata(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "missing url", http.StatusBadRequest)
		return
	}

	parsed, err := url.Parse(target)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}

	data, err := fetchMetadata(r.Context(), parsed)
	if err != nil {
		data = metadataResponse{
			Title:    parsed.Hostname(),
			ImageURL: "",
			Hostname: parsed.Hostname(),
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func fetchMetadata(ctx context.Context, target *url.URL) (metadataResponse, error) {
	redirectCount := 0
	client := &http.Client{
		Timeout: 8 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			redirectCount++
			if redirectCount > maxRedirects {
				return errTooManyRedirects
			}
			return nil
		},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return metadataResponse{}, err
	}
	req.Header.Set("User-Agent", "Brainstorm/0.1")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	resp, err := client.Do(req)
	if err != nil {
		return metadataResponse{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return metadataResponse{}, fmt.Errorf("upstream status %s", resp.Status)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxHTMLBytes))
	if err != nil {
		return metadataResponse{}, err
	}

	baseURL := resp.Request.URL
	metadata := parseHTMLMetadata(string(body))
	title := firstNonEmpty(
		metadata["og:title"],
		metadata["twitter:title"],
		metadata["title"],
	)
	image := firstNonEmpty(
		metadata["og:image:secure_url"],
		metadata["og:image"],
		metadata["twitter:image"],
		metadata["twitter:image:src"],
	)

	host := baseURL.Hostname()
	if title == "" {
		title = host
	}

	imageURL := resolveURL(baseURL, image)
	imageDataURL, err := fetchImageDataURL(ctx, imageURL)
	if err == nil {
		imageURL = imageDataURL
	} else {
		imageURL = ""
	}

	return metadataResponse{
		Title:    title,
		ImageURL: imageURL,
		Hostname: host,
	}, nil
}

func parseHTMLMetadata(htmlText string) map[string]string {
	results := make(map[string]string)
	titleRe := regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	if match := titleRe.FindStringSubmatch(htmlText); len(match) > 1 {
		results["title"] = cleanText(match[1])
	}

	metaRe := regexp.MustCompile(`(?is)<meta\s+[^>]*>`)
	attrRe := regexp.MustCompile(`(?i)([a-zA-Z0-9:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`)
	for _, tag := range metaRe.FindAllString(htmlText, -1) {
		attrs := parseAttributes(tag, attrRe)
		key := strings.ToLower(attrs["property"])
		if key == "" {
			key = strings.ToLower(attrs["name"])
		}
		if key == "" {
			continue
		}
		content := strings.TrimSpace(attrs["content"])
		if content == "" {
			continue
		}
		if _, exists := results[key]; !exists {
			results[key] = content
		}
	}

	return results
}

func parseAttributes(tag string, attrRe *regexp.Regexp) map[string]string {
	attrs := make(map[string]string)
	matches := attrRe.FindAllStringSubmatch(tag, -1)
	for _, match := range matches {
		if len(match) < 3 {
			continue
		}
		name := strings.ToLower(match[1])
		value := ""
		for _, candidate := range match[2:] {
			if candidate == "" {
				continue
			}
			value = strings.Trim(candidate, `"'`)
			break
		}
		attrs[name] = value
	}
	return attrs
}

func cleanText(text string) string {
	decoded := html.UnescapeString(text)
	return strings.Join(strings.Fields(strings.TrimSpace(decoded)), " ")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func resolveURL(base *url.URL, raw string) string {
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	if parsed.IsAbs() {
		return parsed.String()
	}
	return base.ResolveReference(parsed).String()
}

func fetchImageDataURL(ctx context.Context, imageURL string) (string, error) {
	if imageURL == "" {
		return "", fmt.Errorf("empty image url")
	}
	if strings.HasPrefix(imageURL, "data:") {
		return imageURL, nil
	}

	parsed, err := url.Parse(imageURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("invalid image url")
	}

	redirectCount := 0
	client := &http.Client{
		Timeout: 8 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			redirectCount++
			if redirectCount > maxRedirects {
				return errTooManyRedirects
			}
			return nil
		},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "BrainstormPreview/1.0")
	req.Header.Set("Accept", "image/*")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return "", fmt.Errorf("upstream status %s", resp.Status)
	}

	contentType := strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	if !strings.HasPrefix(contentType, "image/") {
		return "", fmt.Errorf("non-image content")
	}

	limited := io.LimitedReader{R: resp.Body, N: maxImageBytes + 1}
	data, err := io.ReadAll(&limited)
	if err != nil {
		return "", err
	}
	if len(data) > maxImageBytes {
		return "", fmt.Errorf("image too large")
	}

	encoded := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:%s;base64,%s", contentType, encoded), nil
}
