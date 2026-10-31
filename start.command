#!/bin/sh
# Double-click to open the map. It needs a small local web server because the browser reads the data tiles.
cd "$(dirname "$0")"
(sleep 1; open "http://localhost:8000/index.html") &
python3 -m http.server 8000 --bind 127.0.0.1
