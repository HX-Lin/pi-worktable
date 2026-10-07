package main

import (
	"fmt"
	"os"
	"strings"
)

// config is read from the environment so no secret ever lives in the repository.
// See relay/README.md for the full list.
type config struct {
	// Addr is either "host:port" or "unix:/path/to.sock".
	Addr string
	// Feishu credentials for the existing self-built app (bot + web app share it).
	FeishuAppID     string
	FeishuAppSecret string
	FeishuBaseURL   string
	// PairingSecret is the pre-shared secret the desktop app sends on register.
	PairingSecret string
	// AllowedOpenIDs is the Feishu open_id allowlist. Empty means "log and allow"
	// so a first-time setup can discover its own open_id; set it right after.
	AllowedOpenIDs map[string]bool
	// DevToken, when set, is accepted as a client token for local testing without
	// going through Feishu login. Leave unset in production.
	DevToken string
	// PublicURL is the H5 address appended to completion pings. Empty means no link.
	PublicURL string
	// NotifyOpenID is where completion pings go. Empty falls back to the last user who
	// signed in, then to the first allowlisted id.
	NotifyOpenID string
}

func loadConfig() (config, error) {
	cfg := config{
		// Default to localhost TCP so nginx can reverse-proxy without socket permission juggling.
		Addr:            envOr("PI_RELAY_ADDR", "127.0.0.1:8787"),
		FeishuAppID:     strings.TrimSpace(os.Getenv("FEISHU_APP_ID")),
		FeishuAppSecret: strings.TrimSpace(os.Getenv("FEISHU_APP_SECRET")),
		FeishuBaseURL:   envOr("FEISHU_BASE_URL", "https://open.feishu.cn"),
		PairingSecret:   strings.TrimSpace(os.Getenv("PI_RELAY_PAIRING_SECRET")),
		AllowedOpenIDs:  map[string]bool{},
		DevToken:        strings.TrimSpace(os.Getenv("PI_RELAY_DEV_TOKEN")),
		PublicURL:       strings.TrimSpace(os.Getenv("PI_RELAY_PUBLIC_URL")),
		NotifyOpenID:    strings.TrimSpace(os.Getenv("PI_RELAY_NOTIFY_OPEN_ID")),
	}
	for _, id := range strings.Split(os.Getenv("PI_RELAY_OPEN_IDS"), ",") {
		if id = strings.TrimSpace(id); id != "" {
			cfg.AllowedOpenIDs[id] = true
		}
	}
	if cfg.FeishuAppID == "" || cfg.FeishuAppSecret == "" {
		return cfg, fmt.Errorf("FEISHU_APP_ID and FEISHU_APP_SECRET are required")
	}
	if cfg.PairingSecret == "" {
		return cfg, fmt.Errorf("PI_RELAY_PAIRING_SECRET is required")
	}
	return cfg, nil
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
