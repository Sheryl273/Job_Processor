#!/usr/bin/env bash
# Creates Jobs.sln and adds all projects. Run once (one person), commit the result.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f Jobs.sln ] || dotnet new sln -n Jobs
dotnet sln Jobs.sln add \
  src/Jobs.Core/Jobs.Core.csproj \
  src/Jobs.Infrastructure/Jobs.Infrastructure.csproj \
  src/Jobs.Api/Jobs.Api.csproj \
  tests/Jobs.Tests/Jobs.Tests.csproj
dotnet build
echo "Solution ready. Next: docker compose up -d db"
