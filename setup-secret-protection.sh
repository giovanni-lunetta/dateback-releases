#!/bin/bash
# Secret Protection Setup for Existing MemSavr Repository
# This adapts the security audit recommendations for your existing git repo

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔐 MemSavr Secret Protection Setup${NC}"
echo "======================================"
echo ""

# Step 1: Install gitleaks
echo -e "${BLUE}[1/4]${NC} Installing gitleaks..."
if command -v gitleaks &> /dev/null; then
    VERSION=$(gitleaks version | head -n1)
    echo -e "${GREEN}✅ gitleaks already installed: $VERSION${NC}"
else
    if command -v brew &> /dev/null; then
        echo "Installing gitleaks via Homebrew..."
        brew install gitleaks
        echo -e "${GREEN}✅ gitleaks installed${NC}"
    else
        echo -e "${RED}❌ Homebrew not found${NC}"
        echo "Install manually:"
        echo "  brew install gitleaks"
        echo "  OR download from: https://github.com/gitleaks/gitleaks/releases"
        exit 1
    fi
fi
echo ""

# Step 2: Install pre-commit hook
echo -e "${BLUE}[2/4]${NC} Installing pre-commit hook..."
if [ -f ".git/hooks/pre-commit" ]; then
    echo -e "${YELLOW}⚠️  Pre-commit hook already exists${NC}"
    read -p "Overwrite? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping existing hook"
    else
        cp ../security_audit/recommended_patches/pre-commit.sh .git/hooks/pre-commit
        chmod +x .git/hooks/pre-commit
        echo -e "${GREEN}✅ Pre-commit hook installed${NC}"
    fi
else
    cp ../security_audit/recommended_patches/pre-commit.sh .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    echo -e "${GREEN}✅ Pre-commit hook installed${NC}"
fi
echo ""

# Step 3: Scan for secrets in codebase
echo -e "${BLUE}[3/4]${NC} Scanning codebase for hardcoded secrets..."
echo "This may take a moment..."
echo ""

# Scan working directory (respects .gitignore)
if gitleaks detect --source . --verbose --no-git 2>&1 | tee /tmp/gitleaks-scan.txt; then
    echo ""
    echo -e "${GREEN}✅ No secrets detected in working directory${NC}"
else
    echo ""
    echo -e "${RED}❌ SECRETS DETECTED in working directory!${NC}"
    echo ""
    echo "Review the output above. If these are real secrets:"
    echo "  1. Move them to .env"
    echo "  2. Use process.env.VARIABLE_NAME in code"
    echo "  3. Re-run this script"
    exit 1
fi
echo ""

# Step 4: Scan git history
echo -e "${BLUE}[4/4]${NC} Scanning git history for committed secrets..."
if gitleaks detect --source . --log-opts="--all" 2>&1 | tee /tmp/gitleaks-history.txt; then
    echo ""
    echo -e "${GREEN}✅ No secrets found in git history${NC}"
else
    echo ""
    echo -e "${YELLOW}⚠️  WARNING: Secrets found in git history!${NC}"
    echo ""
    echo "This means secrets were committed in the past."
    echo ""
    echo "⚠️  If pushed to GitHub, you MUST:"
    echo "  1. Revoke/rotate ALL exposed secrets immediately"
    echo "  2. Consider rewriting git history (destructive)"
    echo "  3. See: ../security_audit/SECRET_PROTECTION_GUIDE.md"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi
echo ""

# Summary
echo -e "${GREEN}======================================"
echo "✅ Secret Protection Setup Complete!"
echo "======================================${NC}"
echo ""
echo "Protection layers active:"
echo "  1. ✅ .gitignore blocks .env files"
echo "  2. ✅ gitleaks installed"
echo "  3. ✅ Pre-commit hook will scan before every commit"
echo "  4. ✅ .env.example provides safe template"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Commit your security fixes:"
echo "     git add main.js python/requirements.txt .env.example"
echo "     git commit -m \"security: Week 3 fixes + secret protection\""
echo ""
echo "  2. The pre-commit hook will automatically scan!"
echo ""
echo "  3. Test it works:"
echo "     echo 'const key = \"ghp_fake123...\"' > test.js"
echo "     git add test.js"
echo "     git commit -m 'test'  # Should be BLOCKED"
echo "     rm test.js"
echo ""
echo -e "${YELLOW}Remember:${NC}"
echo "  - Never commit .env files"
echo "  - Pre-commit hook will block secrets automatically"
echo "  - Run 'gitleaks detect' before releases"
echo ""
echo "Documentation: ../security_audit/SECRET_PROTECTION_GUIDE.md"
