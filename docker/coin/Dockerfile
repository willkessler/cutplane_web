# Coin3D (the open source Open Inventor), to make what reading binary Inventor needs:
# the field types of Inventor's nodes, and binary test files. See make.sh.
FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    libcoin-dev g++ python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /coin
COPY ivbin.cpp fields.cpp ./
RUN g++ -O1 -o ivbin ivbin.cpp -lCoin && g++ -O1 -o fields fields.cpp -lCoin
