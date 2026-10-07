package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// feishuClient exchanges a Feishu JSAPI auth code for the operator's open_id.
// Only the app_access_token and the short-lived user lookup touch the network;
// both are small, in-memory, and bounded.
type feishuClient struct {
	appID     string
	appSecret string
	baseURL   string
	http      *http.Client

	mu          sync.Mutex
	appToken    string
	appTokenExp time.Time
}

type feishuIdentity struct {
	OpenID  string
	UnionID string
	UserID  string
	Name    string
}

func newFeishuClient(appID, appSecret, baseURL string) *feishuClient {
	return &feishuClient{
		appID:     appID,
		appSecret: appSecret,
		baseURL:   baseURL,
		http:      &http.Client{Timeout: 10 * time.Second},
	}
}

func (f *feishuClient) appAccessToken(ctx context.Context) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.appToken != "" && time.Now().Before(f.appTokenExp.Add(-2*time.Minute)) {
		return f.appToken, nil
	}
	var response struct {
		Code           int    `json:"code"`
		Msg            string `json:"msg"`
		AppAccessToken string `json:"app_access_token"`
		Expire         int    `json:"expire"`
	}
	body := map[string]string{"app_id": f.appID, "app_secret": f.appSecret}
	if err := f.doJSON(ctx, http.MethodPost, "/open-apis/auth/v3/app_access_token/internal", "", body, &response); err != nil {
		return "", err
	}
	if response.Code != 0 || response.AppAccessToken == "" {
		return "", fmt.Errorf("feishu app token failed: code=%d msg=%s", response.Code, response.Msg)
	}
	f.appToken = response.AppAccessToken
	expire := response.Expire
	if expire <= 0 {
		expire = 3600
	}
	f.appTokenExp = time.Now().Add(time.Duration(expire) * time.Second)
	return f.appToken, nil
}

func (f *feishuClient) exchangeCode(ctx context.Context, code string) (feishuIdentity, error) {
	token, err := f.appAccessToken(ctx)
	if err != nil {
		return feishuIdentity{}, err
	}
	body := map[string]string{"grant_type": "authorization_code", "code": code}
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			AccessToken string `json:"access_token"`
			OpenID      string `json:"open_id"`
			UnionID     string `json:"union_id"`
			UserID      string `json:"user_id"`
			Name        string `json:"name"`
		} `json:"data"`
	}
	if err := f.doJSON(ctx, http.MethodPost, "/open-apis/authen/v1/oidc/access_token", token, body, &response); err != nil {
		return feishuIdentity{}, err
	}
	if response.Code != 0 {
		return feishuIdentity{}, fmt.Errorf("feishu code exchange failed: code=%d msg=%s", response.Code, response.Msg)
	}
	if response.Data.OpenID != "" {
		return feishuIdentity{
			OpenID:  response.Data.OpenID,
			UnionID: response.Data.UnionID,
			UserID:  response.Data.UserID,
			Name:    response.Data.Name,
		}, nil
	}
	// Some tenants omit open_id from the token response; resolve it explicitly.
	var info struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			OpenID  string `json:"open_id"`
			UnionID string `json:"union_id"`
			UserID  string `json:"user_id"`
			Name    string `json:"name"`
		} `json:"data"`
	}
	if err := f.doJSON(ctx, http.MethodGet, "/open-apis/authen/v1/user_info", response.Data.AccessToken, nil, &info); err != nil {
		return feishuIdentity{}, err
	}
	if info.Code != 0 || info.Data.OpenID == "" {
		return feishuIdentity{}, fmt.Errorf("feishu user lookup failed: code=%d msg=%s", info.Code, info.Msg)
	}
	return feishuIdentity{
		OpenID:  info.Data.OpenID,
		UnionID: info.Data.UnionID,
		UserID:  info.Data.UserID,
		Name:    info.Data.Name,
	}, nil
}

// sendTextMessage sends one direct message to a user.
//
// Used for the "a turn finished while nobody was watching" ping; the bot already has a direct
// conversation with the operator, so an open_id is a valid receive target.
func (f *feishuClient) sendTextMessage(ctx context.Context, openID, text string) error {
	if strings.TrimSpace(openID) == "" || strings.TrimSpace(text) == "" {
		return fmt.Errorf("feishu message needs an open_id and text")
	}
	token, err := f.appAccessToken(ctx)
	if err != nil {
		return err
	}
	content, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return err
	}
	body := map[string]string{
		"receive_id": openID,
		"msg_type":   "text",
		"content":    string(content),
	}
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := f.doJSON(ctx, http.MethodPost, "/open-apis/im/v1/messages?receive_id_type=open_id", token, body, &response); err != nil {
		return err
	}
	if response.Code != 0 {
		return fmt.Errorf("feishu send failed: code=%d msg=%s", response.Code, response.Msg)
	}
	return nil
}

// sendCardMessage sends an interactive card, which is how a notification gets a tappable button.
func (f *feishuClient) sendCardMessage(ctx context.Context, openID string, card any) error {
	if strings.TrimSpace(openID) == "" {
		return fmt.Errorf("feishu card needs an open_id")
	}
	token, err := f.appAccessToken(ctx)
	if err != nil {
		return err
	}
	content, err := json.Marshal(card)
	if err != nil {
		return err
	}
	body := map[string]string{
		"receive_id": openID,
		"msg_type":   "interactive",
		"content":    string(content),
	}
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := f.doJSON(ctx, http.MethodPost, "/open-apis/im/v1/messages?receive_id_type=open_id", token, body, &response); err != nil {
		return err
	}
	if response.Code != 0 {
		return fmt.Errorf("feishu card failed: code=%d msg=%s", response.Code, response.Msg)
	}
	return nil
}

func (f *feishuClient) doJSON(ctx context.Context, method, path, bearer string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, f.baseURL+path, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	response, err := f.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	// Feishu responses are small; cap the read so a bad upstream cannot exhaust memory.
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("feishu http %d: %s", response.StatusCode, string(data))
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("feishu decode failed: %w", err)
	}
	return nil
}
