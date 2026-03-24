#!/usr/bin/env python3
"""Generate simple placeholder icons for the Periodt PWA."""
import struct, zlib, base64

def make_png(size, color=(201, 111, 168)):
    """Create a solid-color PNG."""
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xffffffff
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', c)

    signature = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))

    raw = b''
    for _ in range(size):
        raw += b'\x00' + bytes(color) * size
    compressed = zlib.compress(raw)
    idat = chunk(b'IDAT', compressed)
    iend = chunk(b'IEND', b'')
    return signature + ihdr + idat + iend

import os
os.makedirs('frontend/static/icons', exist_ok=True)
with open('frontend/static/icons/icon-192.png', 'wb') as f:
    f.write(make_png(192))
with open('frontend/static/icons/icon-512.png', 'wb') as f:
    f.write(make_png(512))
print("Icons generated.")
