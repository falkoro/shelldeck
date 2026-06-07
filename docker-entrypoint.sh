#!/bin/sh
set -eu

# Tenant data volumes persist across image upgrades; refresh shipped static assets
# from the image bake on every container start so CSS/JS fixes actually land.
if [ -d /home/shelldeck/baked/public ]; then
  mkdir -p /home/shelldeck/data/public
  cp -a /home/shelldeck/baked/public/. /home/shelldeck/data/public/
fi

exec /usr/local/bin/shelldeck "$@"