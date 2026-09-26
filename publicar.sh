#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# publicar.sh — publica arquivos no site (origin/main) sem tocar no main local.
#
# POR QUE ESTE SCRIPT EXISTE: o main LOCAL tem histórico divergente do
# origin/main (o local carrega os commits do Auria BIM). Dar push do main local
# sobrescreveria o site. Então a publicação sempre passa por um worktree
# temporário criado a partir de origin/main, onde só os arquivos indicados são
# copiados e commitados.
#
# uso:
#   ./publicar.sh "mensagem do commit" arquivo [arquivo...]
#
# exemplos:
#   ./publicar.sh "fix: corrige recorte da prancha" cde_obra.html
#   ./publicar.sh "feat: painel novo" portal.html bi.html
# ---------------------------------------------------------------------------
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "uso: ./publicar.sh \"mensagem do commit\" arquivo [arquivo...]" >&2
  exit 1
fi

MSG="$1"; shift
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="C:/AuriaBuild/pub-$$"

cd "$RAIZ"

# Confere que os arquivos existem ANTES de criar worktree, pra não deixar lixo.
for f in "$@"; do
  [ -f "$RAIZ/$f" ] || { echo "arquivo não encontrado: $f" >&2; exit 1; }
done

# ---------------------------------------------------------------------------
# TRAVA DE SEGREDO (2026-09-26). TUDO que este script publica fica legível na
# web: o site é servido da raiz do repositório, então um arquivo publicado com
# o nome X responde em https://auria.solutions/X. Vale para .sql também — hoje
# há 66 deles no ar.
#
# Isso é aceitável para esquema e policies (um modelo de acesso que só funciona
# enquanto é secreto já está quebrado), mas é fatal para uma CHAVE. O caso
# concreto que motivou a trava: supabase_custos_nf.sql tem a chave de cifra das
# notas fiscais em texto claro. Ele nunca foi publicado — e esta trava existe
# para que continue assim, inclusive por engano.
#
# A anon key do Supabase é pública por natureza e passa (é ela que o navegador
# usa; quem protege o dado é a RLS). Barra JWT de service_role, chaves de API
# e vault.create_secret com literal de verdade.
# ---------------------------------------------------------------------------
BLOQUEADOS=""
for f in "$@"; do
  motivo=""
  # service_role: decodifica o miolo do JWT e procura o papel
  if grep -qE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.' "$RAIZ/$f" 2>/dev/null; then
    for tk in $(grep -oE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+' "$RAIZ/$f" | sort -u); do
      corpo=$(printf '%s' "$tk" | cut -d. -f2)
      case $(( ${#corpo} % 4 )) in 2) corpo="$corpo==" ;; 3) corpo="$corpo=" ;; esac
      if printf '%s' "$corpo" | tr '_-' '/+' | base64 -d 2>/dev/null | grep -q 'service_role'; then
        motivo="JWT de service_role"
      fi
    done
  fi
  grep -qE 'gsk_[A-Za-z0-9]{20,}'        "$RAIZ/$f" 2>/dev/null && motivo="chave Groq"
  grep -qE 're_[A-Za-z0-9_]{20,}'      "$RAIZ/$f" 2>/dev/null && motivo="chave Resend"
  grep -qE 'AIza[A-Za-z0-9_-]{30,}'      "$RAIZ/$f" 2>/dev/null && motivo="chave Google"
  grep -qE 'sk-[A-Za-z0-9]{20,}'       "$RAIZ/$f" 2>/dev/null && motivo="chave OpenAI"
  # create_secret com literal: ignora marcadores tipo '<SEGREDO>' e a anon key
  if grep -oE "create_secret\(\s*'[^']{12,}'" "$RAIZ/$f" 2>/dev/null      | grep -vE "'<" | grep -qv 'eyJ'; then
    motivo="vault.create_secret com segredo literal"
  fi
  [ -n "$motivo" ] && BLOQUEADOS="$BLOQUEADOS
  $f  ($motivo)"
done
if [ -n "$BLOQUEADOS" ]; then
  echo "PUBLICAÇÃO BARRADA — segredo em arquivo que ficaria legível na web:" >&2
  printf "%b
" "$BLOQUEADOS" >&2
  echo "" >&2
  echo "Tire o segredo do arquivo (deixe um marcador tipo '<SEGREDO>' e guarde o" >&2
  echo "valor só no Vault do Supabase) antes de publicar." >&2
  exit 1
fi

git fetch origin -q
git worktree add --detach "$WT" origin/main >/dev/null

for f in "$@"; do
  mkdir -p "$WT/$(dirname "$f")"
  cp "$RAIZ/$f" "$WT/$f"
done

cd "$WT"
git add -- "$@"

if git diff --cached --quiet; then
  echo "nada mudou — nenhum commit criado"
else
  git commit -q -m "$MSG"
  git push origin HEAD:main
  echo "publicado: $(git rev-parse --short HEAD)"
fi

# A limpeza do worktree costuma falhar em metadado travado pelo OneDrive/antivírus;
# o que importa é a pasta física sumir, então o erro é tolerado de propósito.
cd "$RAIZ"
git worktree remove --force "$WT" 2>/dev/null || true
rm -rf "$WT" 2>/dev/null || true
git worktree prune 2>/dev/null || true
