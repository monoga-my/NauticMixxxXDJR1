#!/usr/bin/env python3
"""Check a rekordbox USB export.pdb the way NauticMixxx reads it.

    python3 scripts/check-rekordbox-pdb.py E:/PIONEER/rekordbox/export.pdb

Read-only. This is a Python port of the reader in
patches/0010-rekordbox-usb-only-runtime.patch (src/library/rekordbox/
rekordboxdatabase.cpp). It runs twice:

  * "2.0.0": the reader in the official NauticMixxx 2.0.0 release.
  * "fixed": with the fixes in this branch. A partial last row group is
    compact (4 flag bytes + 2 bytes per row), and album names can use the
    far (u16) name offset.

"FATAL" means NauticMixxx shows the USB as ERROR. Warnings are only
diagnostics; the app still loads the USB.
"""

import collections
import struct
import sys


class Fail(Exception):
    pass


def check(path, fixed):
    data = open(path, "rb").read()

    def u32(offset):
        if offset < 0 or offset > len(data) - 4:
            raise Fail("Truncated DeviceSQL integer")
        return struct.unpack_from("<I", data, offset)[0]

    def u16(offset):
        if offset < 0 or offset > len(data) - 2:
            raise Fail("Truncated DeviceSQL integer")
        return struct.unpack_from("<H", data, offset)[0]

    def read_string(offset, end):
        if offset < 0 or offset >= end or end > len(data):
            raise Fail("DeviceSQL string offset is outside its row")
        kind = data[offset]
        start, length, utf16 = offset + 1, (kind >> 1) - 1, False
        if kind in (0x40, 0x90):
            if end - offset < 4:
                raise Fail("Truncated DeviceSQL long-string header")
            start, length, utf16 = offset + 4, u16(offset + 1) - 4, kind == 0x90
        elif kind & 1 == 0:
            raise Fail("Unsupported DeviceSQL string encoding")
        if length < 0 or length > end - start or (utf16 and length % 2):
            raise Fail("DeviceSQL string exceeds its row")
        try:
            text = data[start:start + length].decode("utf-16-le" if utf16 else "utf-8")
        except UnicodeDecodeError:
            raise Fail("Invalid DeviceSQL string data")
        text = text.rstrip("\0")
        if "\0" in text:
            raise Fail("Embedded null in DeviceSQL string")
        return text

    # Pages and row index (any failure here is fatal).
    page_size, table_count = u32(4), u32(8)
    if (page_size < 76 or page_size > 65536 or len(data) % page_size
            or table_count > (page_size - 28) // 16):
        raise Fail("Invalid DeviceSQL page size or table count")
    if u32(24) != 0:
        raise Fail("Unsupported DeviceSQL header variant")
    page_count = len(data) // page_size
    rows, visited = [], set()
    for table in range(table_count):
        entry = 28 + table * 16
        table_type, page, last = u32(entry), u32(entry + 8), u32(entry + 12)
        if page == 0 and last == 0:
            continue
        if last == 0 or last >= page_count:
            raise Fail("DeviceSQL last-page reference is outside the file")
        while True:
            if page == 0 or page >= page_count:
                raise Fail("DeviceSQL page reference is outside the file")
            base = page * page_size
            if u32(base) != 0 or u32(base + 4) != page:
                raise Fail("Invalid DeviceSQL page identity")
            if u32(base + 8) != table_type:
                break
            if page in visited:
                raise Fail("Cyclic or shared DeviceSQL page chain")
            visited.add(page)
            if data[base + 27] & 0x40 == 0:
                row_count = u16(base + 24) & 0x1FFF
                groups = (row_count + 15) // 16
                if groups > (page_size - 40) // 36:
                    raise Fail("DeviceSQL row index overlaps page header")
                if fixed:
                    partial = row_count % 16
                    heap_end = (page_size - (row_count // 16) * 36
                                - (4 + 2 * partial if partial else 0))
                else:
                    heap_end = page_size - groups * 36
                page_rows = []
                for group in range(groups):
                    end = page_size - group * 36
                    present = u16(base + end - 4)
                    for slot in range(16):
                        if not present & (1 << slot):
                            continue
                        row = group * 16 + slot
                        offset = 40 + u16(base + end - 6 - 2 * slot)
                        if row >= row_count or offset >= heap_end:
                            raise Fail("Invalid live DeviceSQL row offset "
                                       f"(table {table_type}, page {page}, row {row}, "
                                       f"offset {offset}, heap end {heap_end})")
                        page_rows.append([table_type, page, row, base + offset, 0])
                page_rows.sort(key=lambda r: r[3])
                for i, r in enumerate(page_rows):
                    following = page_rows[i + 1][3] if i + 1 < len(page_rows) else base + heap_end
                    r[4] = following - r[3]
                    if r[4] <= 0:
                        raise Fail("Duplicate DeviceSQL row offsets")
                    rows.append(r)
            if page == last:
                break
            page = u32(base + 12)

    # Names and tracks (failures are only warnings in NauticMixxx).
    warnings = collections.Counter()
    names = collections.defaultdict(dict)
    for table_type, page, row, at, size in rows:
        if table_type in (0, 7, 8):
            continue
        try:
            minimum = 0
            if table_type in (1, 4, 13):  # genres, labels, artwork
                if size < 5:
                    raise Fail("Truncated named metadata row")
                ident, text_offset = u32(at), 4
            elif table_type == 5:  # keys
                ident, text_offset = u32(at), 8
            elif table_type == 2:  # artists
                ident = u32(at + 4)
                if u16(at) == 100:
                    text_offset, minimum = u16(at + 10), 12
                else:
                    text_offset, minimum = data[at + 9], 10
            elif table_type == 3:  # albums
                ident = u32(at + 12)
                if fixed and u16(at) == 0x84:
                    text_offset, minimum = u16(at + 22), 24
                else:
                    text_offset, minimum = data[at + 21], 22
            elif table_type == 6:  # colors
                ident, text_offset = u16(at + 5), 8
            else:
                continue
            if text_offset < minimum or text_offset >= size:
                raise Fail("Named metadata offset is outside its payload")
            if ident in names[table_type]:
                raise Fail("Duplicate named metadata identity")
            names[table_type][ident] = read_string(at + text_offset, at + size)
        except Fail as e:
            warnings[f"table {table_type} name: {e}"] += 1

    tracks = titled = 0
    for table_type, page, row, at, size in rows:
        if table_type != 0:
            continue
        try:
            if size < 136:
                raise Fail("Truncated track row")
            offsets = [u16(at + 94 + 2 * i) for i in range(21)]
            values = {}
            for i, offset in enumerate(offsets):
                if offset == 0:
                    continue
                end = at + size
                for other in offsets:
                    if other > offset:
                        end = min(end, at + other)
                try:
                    if offset < 136 or offset >= size:
                        raise Fail("Track string offset is outside its payload")
                    if (i == 0 and end - (at + offset) >= 5 and data[at + offset] == 0x90
                            and data[at + offset + 4] == 3):
                        continue  # ISRC special form
                    values[i] = read_string(at + offset, end)
                except Fail as e:
                    warnings[f"track string {i}: {e}"] += 1
            if not values.get(20):
                raise Fail("Track has no usable audio path")
            tracks += 1
            titled += bool(values.get(17))
        except Fail as e:
            warnings[f"track row: {e}"] += 1

    # Playlists (any failure here is fatal).
    playlists, entries = {}, 0
    for table_type, page, row, at, size in rows:
        if table_type == 7:
            if size < 21:
                raise Fail("Truncated DeviceSQL playlist row")
            ident = u32(at + 12)
            name = read_string(at + 20, at + size)
            if ident == 0 or ident in playlists:
                raise Fail("Invalid or duplicate DeviceSQL playlist identity")
            playlists[ident] = (u32(at), name)
        elif table_type == 8:
            if size < 12:
                raise Fail("Truncated DeviceSQL playlist entry")
            entries += 1
    for ident in playlists:
        seen, parent = set(), ident
        while parent != 0 and parent in playlists:
            if parent in seen or len(seen) >= 256:
                raise Fail("Cyclic or excessively nested DeviceSQL playlist tree")
            seen.add(parent)
            parent = playlists[parent][0]

    return {"tracks": tracks, "tracks_with_title": titled, "playlists": len(playlists),
            "playlist_entries": entries, "warnings": dict(warnings)}


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    for label, fixed in (("2.0.0", False), ("fixed", True)):
        try:
            print(f"{label}: {check(sys.argv[1], fixed)}")
        except Fail as e:
            print(f"{label}: FATAL: {e}")


if __name__ == "__main__":
    main()
