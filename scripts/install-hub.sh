#!/usr/bin/env bash
# Sonde Hub Installer
# Usage: bash install-hub.sh
set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────
SONDE_VERSION="0.1.0"
SONDE_REPO="https://github.com/sonde-dev/sonde.git"
SONDE_BRANCH="main"
HUB_PORT=3000

# ── Colors ───────────────────────────────────────────────────────────
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  RED=$(tput setaf 1) GREEN=$(tput setaf 2) YELLOW=$(tput setaf 3)
  BLUE=$(tput setaf 4) BOLD=$(tput bold) RESET=$(tput sgr0)
else
  RED="" GREEN="" YELLOW="" BLUE="" BOLD="" RESET=""
fi

# ── Pipe Detection ───────────────────────────────────────────────────
if [ ! -t 0 ]; then
  echo "Error: This script requires interactive input."
  echo "Download and run it directly:"
  echo ""
  echo "  curl -fsSL https://raw.githubusercontent.com/sonde-dev/sonde/main/scripts/install-hub.sh -o install-hub.sh"
  echo "  bash install-hub.sh"
  echo ""
  exit 1
fi

# ── Utility Functions ────────────────────────────────────────────────
info()    { echo "${BLUE}${BOLD}[info]${RESET}  $*"; }
success() { echo "${GREEN}${BOLD}[ok]${RESET}    $*"; }
warn()    { echo "${YELLOW}${BOLD}[warn]${RESET}  $*"; }
error()   { echo "${RED}${BOLD}[error]${RESET} $*" >&2; }

confirm() {
  local prompt="${1:-Continue?}"
  local reply
  printf "%s [y/N] " "$prompt"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

need_cmd() {
  if ! command -v "$1" &>/dev/null; then
    return 1
  fi
  return 0
}

generate_key() {
  if need_cmd openssl; then
    openssl rand -hex 32
  elif [ -r /dev/urandom ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    error "Cannot generate random key (no openssl or /dev/urandom)"
    exit 1
  fi
}

generate_self_signed_cert() {
  local cert_dir="${INSTALL_DIR}/certs"
  mkdir -p "$cert_dir"
  info "Generating self-signed certificate for localhost..."
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -nodes -days 365 \
    -subj '/CN=localhost' \
    -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
    -keyout "${cert_dir}/localhost.key" \
    -out "${cert_dir}/localhost.crt" 2>/dev/null
  chmod 600 "${cert_dir}/localhost.key"
  success "Certificate saved to ${cert_dir}/"
}

validate_domain() {
  local domain="$1"
  domain="${domain#http://}"
  domain="${domain#https://}"
  domain="${domain%%/*}"
  if [[ "$domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$ ]]; then
    echo "$domain"
    return 0
  fi
  return 1
}

# ── OS / Arch / Distro Detection ────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Linux*)  OS="linux" ;;
    Darwin*) OS="darwin" ;;
    *)       error "Unsupported OS: $(uname -s)"; exit 1 ;;
  esac
}

detect_distro() {
  if [ "$OS" = "darwin" ]; then
    DISTRO="macos"
    return
  fi
  if [ -f /etc/os-release ]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    case "${ID:-unknown}" in
      debian)       DISTRO="debian" ;;
      ubuntu)       DISTRO="ubuntu" ;;
      centos)       DISTRO="centos" ;;
      fedora)       DISTRO="fedora" ;;
      rhel|rocky|alma) DISTRO="rhel" ;;
      arch|manjaro) DISTRO="arch" ;;
      alpine)       DISTRO="alpine" ;;
      *)            DISTRO="unknown" ;;
    esac
  else
    DISTRO="unknown"
  fi
}

detect_arch() {
  case "$(uname -m)" in
    x86_64)          ARCH="x86_64" ;;
    aarch64|arm64)   ARCH="arm64" ;;
    *)               error "Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
}

detect_pkg_manager() {
  if need_cmd apt-get;  then PKG_MGR="apt"; return; fi
  if need_cmd dnf;      then PKG_MGR="dnf"; return; fi
  if need_cmd yum;      then PKG_MGR="yum"; return; fi
  if need_cmd pacman;   then PKG_MGR="pacman"; return; fi
  if need_cmd apk;      then PKG_MGR="apk"; return; fi
  if need_cmd brew;     then PKG_MGR="brew"; return; fi
  PKG_MGR="none"
}

# ── Prerequisite Checks ─────────────────────────────────────────────
check_port() {
  local port="$1"
  if need_cmd ss; then
    ss -tlnp 2>/dev/null | grep -q ":${port} " && return 0
  elif need_cmd lsof; then
    lsof -iTCP:"${port}" -sTCP:LISTEN &>/dev/null && return 0
  fi
  return 1
}

install_pkg() {
  local pkg="$1"
  info "Installing ${pkg}..."
  case "$PKG_MGR" in
    apt)    sudo apt-get update -qq && sudo apt-get install -y -qq "$pkg" ;;
    dnf)    sudo dnf install -y -q "$pkg" ;;
    yum)    sudo yum install -y -q "$pkg" ;;
    pacman) sudo pacman -S --noconfirm "$pkg" ;;
    apk)    sudo apk add --quiet "$pkg" ;;
    brew)   brew install "$pkg" ;;
    *)      error "No package manager found. Install ${pkg} manually."; exit 1 ;;
  esac
}

ensure_docker() {
  if need_cmd docker; then
    success "Docker found: $(docker --version)"
  else
    warn "Docker not found."
    if ! confirm "Install Docker?"; then
      error "Docker is required. Install it and re-run."
      exit 1
    fi
    if [ "$OS" = "darwin" ]; then
      if need_cmd brew; then
        brew install --cask docker
        warn "Start Docker Desktop before continuing."
        echo "  Press Enter when Docker Desktop is running..."
        read -r
      else
        error "Install Docker Desktop from https://docker.com/products/docker-desktop"
        exit 1
      fi
    else
      info "Installing Docker via get.docker.com..."
      curl -fsSL https://get.docker.com | sh
      success "Docker installed."
    fi
  fi

  # Linux: ensure docker group + service running
  if [ "$OS" = "linux" ]; then
    if [ "$(id -u)" -ne 0 ] && ! groups | grep -q docker; then
      warn "Current user is not in the 'docker' group."
      if confirm "Add $(whoami) to docker group? (requires sudo)"; then
        sudo usermod -aG docker "$(whoami)"
        warn "Group membership updated. You may need to log out and back in."
        warn "For now, the script will use sudo for docker commands."
      fi
    fi
    if need_cmd systemctl; then
      if ! systemctl is-active --quiet docker 2>/dev/null; then
        info "Starting Docker service..."
        sudo systemctl start docker
        sudo systemctl enable docker
      fi
    fi
  fi
}

ensure_compose() {
  if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
    success "Docker Compose found: $(docker compose version --short)"
    return
  fi
  if command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
    success "Docker Compose (standalone) found: $(docker-compose version --short)"
    return
  fi

  warn "Docker Compose not found."
  if ! confirm "Install Docker Compose plugin?"; then
    error "Docker Compose is required."
    exit 1
  fi
  if [ "$OS" = "darwin" ]; then
    warn "Docker Compose is included with Docker Desktop. Ensure Docker Desktop is running."
    exit 1
  fi
  # Linux: install plugin via package manager
  case "$PKG_MGR" in
    apt) sudo apt-get update -qq && sudo apt-get install -y -qq docker-compose-plugin ;;
    dnf) sudo dnf install -y -q docker-compose-plugin ;;
    yum) sudo yum install -y -q docker-compose-plugin ;;
    *)
      info "Installing Docker Compose plugin manually..."
      local compose_arch="$ARCH"
      [ "$compose_arch" = "arm64" ] && compose_arch="aarch64"
      sudo mkdir -p /usr/local/lib/docker/cli-plugins
      sudo curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${compose_arch}" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
      sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
      ;;
  esac
  if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
    success "Docker Compose installed."
  else
    error "Docker Compose installation failed."
    exit 1
  fi
}

ensure_git() {
  if need_cmd git; then
    success "Git found: $(git --version)"
    return
  fi
  warn "Git not found."
  if ! confirm "Install git?"; then
    error "Git is required."
    exit 1
  fi
  install_pkg git
  if need_cmd git; then
    success "Git installed."
  else
    error "Git installation failed."
    exit 1
  fi
}

check_ports() {
  local mode="$1"
  if [ "$mode" = "local" ] || [ "$mode" = "traefik" ]; then
    if check_port "$HUB_PORT"; then
      warn "Port ${HUB_PORT} is already in use."
    fi
  fi
  if [ "$mode" = "traefik" ]; then
    if check_port 80; then
      warn "Port 80 is already in use (needed for Traefik)."
    fi
    if check_port 443; then
      warn "Port 443 is already in use (needed for Traefik)."
    fi
  fi
}

# ── Networking Mode Selection ────────────────────────────────────────
select_network_mode() {
  echo ""
  echo "${BOLD}How should the hub be accessed?${RESET}"
  echo ""
  echo "  1) Public domain (Traefik + Let's Encrypt TLS)"
  echo "  2) Cloudflare Tunnel (zero port forwarding)"
  echo "  3) Local only (plain HTTP or Tailscale)"
  echo ""

  local choice
  while true; do
    printf "Select [1-3]: "
    read -r choice
    case "$choice" in
      1) configure_traefik;    break ;;
      2) configure_cloudflare; break ;;
      3) configure_local;      break ;;
      *) warn "Invalid choice." ;;
    esac
  done
}

configure_traefik() {
  NETWORK_MODE="traefik"

  local raw_domain
  printf "Domain name (e.g. sonde.example.com): "
  read -r raw_domain
  SONDE_DOMAIN=$(validate_domain "$raw_domain") || {
    error "Invalid domain: ${raw_domain}"
    exit 1
  }

  printf "Email for Let's Encrypt (e.g. admin@example.com): "
  read -r ACME_EMAIL
  if [ -z "$ACME_EMAIL" ]; then
    error "Email is required for Let's Encrypt."
    exit 1
  fi

  SONDE_HUB_URL="https://${SONDE_DOMAIN}"
  check_ports traefik
  success "Traefik mode: ${SONDE_HUB_URL}"
}

configure_cloudflare() {
  NETWORK_MODE="cloudflare"

  if ! need_cmd cloudflared; then
    warn "cloudflared not found."
    if confirm "Install cloudflared?"; then
      if [ "$OS" = "darwin" ] && need_cmd brew; then
        brew install cloudflared
      elif [ "$OS" = "linux" ]; then
        case "$PKG_MGR" in
          apt)
            curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
            echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
            sudo apt-get update -qq && sudo apt-get install -y -qq cloudflared
            ;;
          *)
            local cf_arch="amd64"
            [ "$ARCH" = "arm64" ] && cf_arch="arm64"
            curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cf_arch}" -o /tmp/cloudflared
            sudo install -m 755 /tmp/cloudflared /usr/local/bin/cloudflared
            rm -f /tmp/cloudflared
            ;;
        esac
      else
        error "Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        exit 1
      fi
    else
      error "cloudflared is required for Cloudflare Tunnel mode."
      exit 1
    fi
  fi
  success "cloudflared found: $(cloudflared --version 2>&1 | head -1)"

  echo ""
  if confirm "Do you already have a tunnel created for Sonde?"; then
    info "Use: cloudflared tunnel token <TUNNEL_NAME> to get the token."
  else
    echo ""
    info "Create a tunnel with these commands:"
    echo "  cloudflared tunnel login"
    echo "  cloudflared tunnel create sonde-hub"
    echo "  cloudflared tunnel token sonde-hub"
    echo ""
    info "Run those commands, then come back with the token."
  fi

  echo ""
  printf "Tunnel token: "
  read -r CF_TUNNEL_TOKEN
  if [ -z "$CF_TUNNEL_TOKEN" ]; then
    error "Tunnel token is required."
    exit 1
  fi

  printf "Public hostname (e.g. sonde.example.com): "
  read -r raw_hostname
  SONDE_DOMAIN=$(validate_domain "$raw_hostname") || {
    error "Invalid hostname: ${raw_hostname}"
    exit 1
  }

  SONDE_HUB_URL="https://${SONDE_DOMAIN}"
  success "Cloudflare Tunnel mode: ${SONDE_HUB_URL}"
}

configure_local() {
  NETWORK_MODE="local"

  # Check for Tailscale
  if need_cmd tailscale; then
    local ts_status
    ts_status=$(tailscale status --json 2>/dev/null || echo "")
    if [ -n "$ts_status" ]; then
      local ts_hostname
      ts_hostname=$(echo "$ts_status" | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\.$//')
      if [ -n "$ts_hostname" ] && confirm "Tailscale detected (${ts_hostname}). Use Tailscale hostname?"; then
        SONDE_HUB_URL="http://${ts_hostname}:${HUB_PORT}"
        check_ports local
        success "Local mode (Tailscale): ${SONDE_HUB_URL}"
        return
      fi
    fi
  fi

  echo ""
  echo "  a) HTTP only — http://localhost:${HUB_PORT}"
  echo "  b) HTTPS with self-signed certificate"
  echo ""
  local tls_choice
  while true; do
    printf "Select [a/b]: "
    read -r tls_choice
    case "$tls_choice" in
      a|A)
        SONDE_HUB_URL="http://localhost:${HUB_PORT}"
        check_ports local
        success "Local mode (HTTP): ${SONDE_HUB_URL}"
        return
        ;;
      b|B)
        NETWORK_MODE="local-tls"
        SONDE_HUB_URL="https://localhost"
        if check_port 443; then
          warn "Port 443 is already in use."
        fi
        success "Local mode (HTTPS): ${SONDE_HUB_URL}"
        warn "Your browser will show a certificate warning — this is expected for self-signed certs."
        return
        ;;
      *) warn "Invalid choice." ;;
    esac
  done
}

# ── Install Directory + Clone ────────────────────────────────────────
setup_install_dir() {
  if [ "$(id -u)" -eq 0 ]; then
    INSTALL_DIR="/opt/sonde"
  else
    INSTALL_DIR="${HOME}/.sonde/hub"
  fi

  info "Install directory: ${INSTALL_DIR}"

  if [ -d "$INSTALL_DIR" ]; then
    if [ -d "${INSTALL_DIR}/.git" ]; then
      info "Existing installation found. Updating..."
      git -C "$INSTALL_DIR" pull --ff-only || {
        warn "Git pull failed. Continuing with existing code."
      }
      return
    else
      warn "${INSTALL_DIR} exists but is not a git repo."
      if confirm "Remove it and clone fresh?"; then
        rm -rf "$INSTALL_DIR"
      else
        error "Cannot continue with non-git directory."
        exit 1
      fi
    fi
  fi

  info "Cloning Sonde repository..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 --branch "$SONDE_BRANCH" "$SONDE_REPO" "$INSTALL_DIR"
  success "Repository cloned."
}

# ── .env Generation ──────────────────────────────────────────────────
generate_env() {
  local env_file="${INSTALL_DIR}/.env"

  if [ -f "$env_file" ]; then
    # Preserve existing secret (check both new and old var names)
    SONDE_SECRET=$(sed -n 's/^SONDE_SECRET=//p' "$env_file" 2>/dev/null || echo "")
    if [ -z "$SONDE_SECRET" ]; then
      SONDE_SECRET=$(sed -n 's/^SONDE_API_KEY=//p' "$env_file" 2>/dev/null || echo "")
    fi
    if [ -n "$SONDE_SECRET" ]; then
      info "Preserving existing secret from .env"
    fi
  fi

  if [ -z "${SONDE_SECRET:-}" ]; then
    SONDE_SECRET=$(generate_key)
    info "Generated new secret."
  fi

  cat > "$env_file" <<EOF
# Sonde Hub Configuration — generated by install-hub.sh
SONDE_SECRET=${SONDE_SECRET}
SONDE_HUB_URL=${SONDE_HUB_URL}
SONDE_DB_PATH=/data/sonde.db
EOF

  case "$NETWORK_MODE" in
    traefik)
      cat >> "$env_file" <<EOF
SONDE_DOMAIN=${SONDE_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
EOF
      ;;
    cloudflare)
      cat >> "$env_file" <<EOF
SONDE_DOMAIN=${SONDE_DOMAIN}
CF_TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
EOF
      ;;
  esac

  chmod 600 "$env_file"
  success "Environment file written."
}

# ── Compose File Generation ─────────────────────────────────────────
generate_compose() {
  local compose_file="${INSTALL_DIR}/docker-compose.prod.yml"

  case "$NETWORK_MODE" in
    local)
      cat > "$compose_file" <<'YAML'
services:
  sonde-hub:
    build:
      context: .
      dockerfile: docker/hub.Dockerfile
    env_file: .env
    volumes:
      - hub-data:/data
    ports:
      - '3000:3000'
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'wget', '--spider', '-q', 'http://localhost:3000/health']
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

volumes:
  hub-data:
YAML
      ;;
    traefik)
      cat > "$compose_file" <<'YAML'
services:
  traefik:
    image: traefik:v3.3
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}
      - --certificatesresolvers.letsencrypt.acme.storage=/certs/acme.json
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-certs:/certs
    restart: unless-stopped

  sonde-hub:
    build:
      context: .
      dockerfile: docker/hub.Dockerfile
    env_file: .env
    volumes:
      - hub-data:/data
    restart: unless-stopped
    labels:
      - traefik.enable=true
      - traefik.http.routers.sonde.rule=Host(`${SONDE_DOMAIN}`)
      - traefik.http.routers.sonde.entrypoints=websecure
      - traefik.http.routers.sonde.tls.certresolver=letsencrypt
      - traefik.http.services.sonde.loadbalancer.server.port=3000
    healthcheck:
      test: ['CMD', 'wget', '--spider', '-q', 'http://localhost:3000/health']
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

volumes:
  hub-data:
  traefik-certs:
YAML
      ;;
    cloudflare)
      cat > "$compose_file" <<'YAML'
services:
  sonde-hub:
    build:
      context: .
      dockerfile: docker/hub.Dockerfile
    env_file: .env
    volumes:
      - hub-data:/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'wget', '--spider', '-q', 'http://localhost:3000/health']
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${CF_TUNNEL_TOKEN}
    depends_on:
      sonde-hub:
        condition: service_healthy
    restart: unless-stopped

volumes:
  hub-data:
YAML
      ;;
    local-tls)
      cat > "$compose_file" <<'YAML'
services:
  sonde-hub:
    build:
      context: .
      dockerfile: docker/hub.Dockerfile
    env_file: .env
    volumes:
      - hub-data:/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'wget', '--spider', '-q', 'http://localhost:3000/health']
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  caddy:
    image: caddy:2-alpine
    ports:
      - '443:443'
    volumes:
      - ./certs:/certs:ro
      - caddy-data:/data
    command: caddy reverse-proxy --from https://localhost --to http://sonde-hub:3000 --tls /certs/localhost.crt /certs/localhost.key
    depends_on:
      sonde-hub:
        condition: service_healthy
    restart: unless-stopped

volumes:
  hub-data:
  caddy-data:
YAML
      ;;
  esac

  success "Compose file generated (${NETWORK_MODE} mode)."
}

# ── Build + Launch ───────────────────────────────────────────────────
build_and_launch() {
  info "Building and starting Sonde Hub..."

  cd "$INSTALL_DIR"

  # Stop existing containers if re-running
  $COMPOSE_CMD -f docker-compose.prod.yml down 2>/dev/null || true

  info "Building Docker image (this may take a few minutes on first run)..."
  $COMPOSE_CMD -f docker-compose.prod.yml build

  info "Starting services..."
  $COMPOSE_CMD -f docker-compose.prod.yml up -d

  success "Services started."
}

# ── Health Check ─────────────────────────────────────────────────────
wait_for_healthy() {
  info "Waiting for hub to become healthy..."

  local attempts=30
  local delay=2
  local i=0

  if [ "$NETWORK_MODE" = "cloudflare" ] || [ "$NETWORK_MODE" = "local-tls" ]; then
    # No direct host port for hub — check container health via docker
    while [ $i -lt $attempts ]; do
      local health
      health=$(docker inspect --format='{{.State.Health.Status}}' "$(docker ps -qf name=sonde-hub)" 2>/dev/null || echo "unknown")
      if [ "$health" = "healthy" ]; then
        success "Hub is healthy."
        return 0
      fi
      i=$((i + 1))
      printf "  Attempt %d/%d (status: %s)...\r" "$i" "$attempts" "$health"
      sleep "$delay"
    done
  else
    while [ $i -lt $attempts ]; do
      if curl -sf "http://localhost:${HUB_PORT}/health" >/dev/null 2>&1; then
        echo ""
        success "Hub is healthy."
        return 0
      fi
      i=$((i + 1))
      printf "  Attempt %d/%d...\r" "$i" "$attempts"
      sleep "$delay"
    done
  fi

  echo ""
  warn "Hub did not become healthy within $((attempts * delay))s."
  warn "Check logs: ${COMPOSE_CMD} -f ${INSTALL_DIR}/docker-compose.prod.yml logs"
  return 1
}

# ── Summary ──────────────────────────────────────────────────────────
print_summary() {
  local key_preview="${SONDE_SECRET:0:12}..."

  echo ""
  echo "${BOLD}============================================${RESET}"
  echo "${BOLD}    Sonde Hub Installation Complete${RESET}"
  echo "${BOLD}============================================${RESET}"
  echo ""
  echo "  Dashboard:  ${GREEN}${SONDE_HUB_URL}${RESET}"
  echo "  Secret:     ${YELLOW}${SONDE_SECRET}${RESET}"
  echo "  Install:    ${INSTALL_DIR}"
  echo "  Data:       Docker volume 'hub-data'"
  echo ""
  echo "${BOLD}Next Steps:${RESET}"
  echo "  1. Open ${SONDE_HUB_URL} to complete the setup wizard"
  echo "  2. Enroll an agent on a target machine:"
  echo ""
  echo "     sonde enroll --hub ${SONDE_HUB_URL} --key ${key_preview} --name my-server"
  echo "     sonde start"
  echo ""
  echo "${BOLD}Useful commands:${RESET}"
  echo "  View logs:   ${COMPOSE_CMD} -f ${INSTALL_DIR}/docker-compose.prod.yml logs -f"
  echo "  Stop hub:    ${COMPOSE_CMD} -f ${INSTALL_DIR}/docker-compose.prod.yml down"
  echo "  Update:      cd ${INSTALL_DIR} && git pull && ${COMPOSE_CMD} -f docker-compose.prod.yml up -d --build"
  echo ""

  case "$NETWORK_MODE" in
    traefik)
      echo "${YELLOW}${BOLD}DNS:${RESET} Ensure ${SONDE_DOMAIN} points to this server's public IP."
      echo ""
      ;;
    cloudflare)
      echo "${YELLOW}${BOLD}Tunnel:${RESET} Ensure the tunnel routes ${SONDE_DOMAIN} to http://sonde-hub:3000"
      echo ""
      ;;
    local-tls)
      echo "${YELLOW}${BOLD}TLS:${RESET} Using self-signed certificate. Your browser will show a warning — this is expected."
      echo ""
      ;;
  esac

  echo "${RED}${BOLD}IMPORTANT:${RESET} Save the secret above securely. It cannot be recovered."
  echo ""

  # Offer to install the agent on this same machine
  if confirm "Install @sonde/agent on this machine too?"; then
    if command -v sonde >/dev/null 2>&1; then
      info "sonde CLI already installed, skipping npm install."
    elif command -v npm >/dev/null 2>&1; then
      info "Installing @sonde/agent globally via npm..."
      npm install -g @sonde/agent
    else
      warn "npm not found. Install the agent manually:"
      echo "  npm install -g @sonde/agent"
      echo ""
      return
    fi
    echo ""
    info "Launching agent installer TUI..."
    sonde install --hub "${SONDE_HUB_URL}"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────
main() {
  echo ""
  echo "${BOLD}Sonde Hub Installer v${SONDE_VERSION}${RESET}"
  echo ""

  # Detect environment
  detect_os
  detect_distro
  detect_arch
  detect_pkg_manager
  info "Detected: ${OS} / ${DISTRO} / ${ARCH} (pkg: ${PKG_MGR})"

  # Check prerequisites
  echo ""
  info "Checking prerequisites..."
  ensure_docker
  ensure_compose
  ensure_git

  # Networking
  select_network_mode

  # Install
  echo ""
  setup_install_dir
  generate_env
  if [ "$NETWORK_MODE" = "local-tls" ]; then
    generate_self_signed_cert
  fi
  generate_compose

  # Build + launch
  echo ""
  build_and_launch

  # Health check
  echo ""
  if wait_for_healthy; then
    print_summary
  else
    echo ""
    warn "Installation completed but the hub may not be running correctly."
    warn "Secret: ${SONDE_SECRET}"
    warn "Check logs and try: ${COMPOSE_CMD} -f ${INSTALL_DIR}/docker-compose.prod.yml logs"
  fi
}

main "$@"
