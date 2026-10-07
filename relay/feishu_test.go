package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestFeishuExchangeCodeResolvesOpenIDFromToken(t *testing.T) {
	var tokenCalls int32
	mux := http.NewServeMux()
	mux.HandleFunc("/open-apis/auth/v3/app_access_token/internal", func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&tokenCalls, 1)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 0, "app_access_token": "app-token", "expire": 7200,
		})
	})
	mux.HandleFunc("/open-apis/authen/v1/oidc/access_token", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer app-token" {
			t.Errorf("unexpected authorization header: %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 0,
			"data": map[string]any{"access_token": "user-token", "open_id": "ou_abc", "name": "Lin"},
		})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := newFeishuClient("id", "secret", server.URL)
	identity, err := client.exchangeCode(context.Background(), "code-1")
	if err != nil {
		t.Fatalf("exchangeCode failed: %v", err)
	}
	if identity.OpenID != "ou_abc" || identity.Name != "Lin" {
		t.Fatalf("unexpected identity: %#v", identity)
	}
	// The app token must be cached across calls.
	if _, err := client.exchangeCode(context.Background(), "code-2"); err != nil {
		t.Fatalf("second exchangeCode failed: %v", err)
	}
	if calls := atomic.LoadInt32(&tokenCalls); calls != 1 {
		t.Fatalf("expected a single app token request, got %d", calls)
	}
}

func TestFeishuExchangeCodeFallsBackToUserInfo(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/open-apis/auth/v3/app_access_token/internal", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "app_access_token": "app-token", "expire": 7200})
	})
	mux.HandleFunc("/open-apis/authen/v1/oidc/access_token", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 0,
			"data": map[string]any{"access_token": "user-token"},
		})
	})
	mux.HandleFunc("/open-apis/authen/v1/user_info", func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer user-token" {
			t.Errorf("unexpected user authorization: %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 0,
			"data": map[string]any{"open_id": "ou_from_info"},
		})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	identity, err := newFeishuClient("id", "secret", server.URL).exchangeCode(context.Background(), "code")
	if err != nil {
		t.Fatalf("exchangeCode failed: %v", err)
	}
	if identity.OpenID != "ou_from_info" {
		t.Fatalf("expected fallback open_id, got %#v", identity)
	}
}

func TestFeishuExchangeCodeSurfacesErrors(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/open-apis/auth/v3/app_access_token/internal", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "app_access_token": "app-token", "expire": 7200})
	})
	mux.HandleFunc("/open-apis/authen/v1/oidc/access_token", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 20038, "msg": "code expired"})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	if _, err := newFeishuClient("id", "secret", server.URL).exchangeCode(context.Background(), "bad"); err == nil {
		t.Fatal("expected an error for a failed code exchange")
	}
}
