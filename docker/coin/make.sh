#!/bin/sh
# Remakes, with Coin3D in Docker, the field type table binary Inventor is read with
# (packages/formats/src/mesh/inventorfields.ts) and the binary test files beside
# their ASCII sources (packages/formats/test/fixtures). Run from the repo root.
set -e
docker build -q -t cutplane-coin docker/coin >/dev/null
docker run --rm cutplane-coin ./fields | python3 docker/coin/table.py > packages/formats/src/mesh/inventorfields.ts
# (Written in the container to the mounted folder: through docker's stdout the bytes come out changed.)
for f in packages/formats/test/fixtures/*.ascii.iv; do
  n=$(basename "$f" .ascii.iv)
  docker run --rm -v "$PWD/packages/formats/test/fixtures:/f" cutplane-coin ./ivbin "/f/$n.ascii.iv" "/f/$n.bin.iv"
done
