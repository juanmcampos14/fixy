#!/usr/bin/env bash
# ============================================================
# Wrapper de Semgrep para Fixy
# ============================================================
# Semgrep se instaló con `pip3 install --user` → el binario NO está en PATH global. Este wrapper lo
# encuentra (user-install típico) y corre sin telemetría. Lo usan los npm scripts (semgrep / semgrep:arch).
set -euo pipefail
export PATH="$HOME/Library/Python/3.9/bin:$HOME/.local/bin:$PATH"
export SEMGREP_SEND_METRICS=off
export PYTHONWARNINGS="ignore"   # silencia el aviso urllib3/LibreSSL del Python del sistema

if ! command -v semgrep >/dev/null 2>&1; then
  echo "✗ semgrep no encontrado. Instalá con: pip3 install --user semgrep" >&2
  exit 127
fi
exec semgrep "$@"
