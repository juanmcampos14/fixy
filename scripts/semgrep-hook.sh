#!/usr/bin/env bash
# ============================================================
# Hook PostToolUse de Claude Code: corre las reglas de arquitectura de Fixy (sólo ERROR) sobre el archivo
# recién editado. Rápido (un archivo), sin red. Si hay violación sale con código 2 para que Claude Code la
# vea como feedback y la corrija antes de seguir. Nunca bloquea por reglas WARNING (deuda conocida).
# Se activa desde .claude/settings.local.json (ver .semgrep/README.md).
# ============================================================
input=$(cat)
file=$(printf '%s' "$input" | python3 -c "import sys,json;print((json.load(sys.stdin).get('tool_input') or {}).get('file_path',''))" 2>/dev/null || echo "")
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -n "$file" ] && [ -f "$file" ] || exit 0

# Ruta relativa a la raíz: las reglas filtran por carpeta (app/api/admin/**, src/app/**, …).
case "$file" in
  "$root"/*) rel="${file#$root/}" ;;
  *) exit 0 ;;   # archivo fuera del proyecto
esac
case "$rel" in
  src/*.ts|src/*.tsx) ;;
  *) exit 0 ;;
esac

export PATH="$HOME/Library/Python/3.9/bin:$HOME/.local/bin:$PATH"
export SEMGREP_SEND_METRICS=off
export PYTHONWARNINGS="ignore"
command -v semgrep >/dev/null 2>&1 || exit 0   # semgrep no instalado → no molestar

cd "$root" || exit 0
[ -f ".semgrep/fixy.yml" ] || exit 0
out=$(semgrep scan --config ".semgrep/fixy.yml" --severity ERROR --metrics=off --no-git-ignore --quiet "$rel" 2>/dev/null || true)

if [ -n "$out" ]; then
  echo "⚠️ Semgrep — posible violación de arquitectura de Fixy en $rel:" >&2
  echo "$out" >&2
  exit 2   # feedback a Claude Code (no fatal para el usuario)
fi
exit 0
