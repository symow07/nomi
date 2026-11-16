#!/usr/bin/env python3
"""Prove the CLAUDE.md extraction against its pinned Git source.

Run from any directory: python3 docs/team/verify-claudemd-moves.py
Line accounting is occurrence-based: identical blank lines are separate source
occurrences, each assigned to exactly one destination span.
"""
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess


def verify():
    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / 'docs/team/claudemd-moves.json').read_text())
    source = subprocess.check_output(
        ['git', 'show', manifest['base_commit'] + ':CLAUDE.md'], cwd=root)
    assert sha256(source).hexdigest() == manifest['source_sha256'], 'Source changed'
    expected_files = {}
    expected_main = []
    removed_lines = Counter()
    assignments = {}
    cursor = 0
    for move in manifest['moves']:
        start, end = move['start'], move['end']
        assert cursor <= start < end <= len(source), 'Overlapping/out-of-order moves'
        assert start == 0 or source[start - 1:start] == b'\n', 'Not a line boundary'
        assert source[end - 1:end] == b'\n', 'Not a line boundary'
        block = source[start:end]
        assert len(block) == move['bytes']
        assert len(block.decode('utf-8')) == move['characters']
        assert sha256(block).hexdigest() == move['sha256'], move['label']
        destination = move['destination']
        assert destination.startswith('docs/team/') and destination != 'docs/team/state.md'
        actual = (root / destination).read_bytes()
        offset = len(expected_files.get(destination, b''))
        assert actual[offset:offset + len(block)] == block, move['label']
        assert actual.count(block) == 1, 'Block missing or duplicated'
        expected_files[destination] = expected_files.get(destination, b'') + block
        position = start
        for line in block.splitlines(keepends=True):
            assert position not in assignments, 'Source line assigned twice'
            assignments[position] = (destination, offset)
            assert actual[offset:offset + len(line)] == line
            removed_lines[line] += 1
            position += len(line)
            offset += len(line)
        expected_main.extend([source[cursor:start], move['replacement'].encode('utf-8')])
        cursor = end
    expected_main.append(source[cursor:])
    current = (root / 'CLAUDE.md').read_bytes()
    assert current == b''.join(expected_main), 'Unapproved changes outside replacement spans'
    copied_lines = Counter()
    for destination, expected in expected_files.items():
        actual = (root / destination).read_bytes()
        assert actual == expected, 'Extra/missing/changed destination text: ' + destination
        copied_lines.update(actual.splitlines(keepends=True))
    assert removed_lines == copied_lines, 'Removed/copied line occurrences differ'
    # Reconstruct the full original, including whitespace, using destination bytes.
    rebuilt = current
    for move in reversed(manifest['moves']):
        replacement = move['replacement'].encode('utf-8')
        assert rebuilt.count(replacement) == 1, 'Ambiguous replacement'
        block = source[move['start']:move['end']]
        rebuilt = rebuilt.replace(replacement, block, 1)
    assert rebuilt == source, 'Original does not reconstruct'
    rules = (root / 'docs/team/rules.md').read_bytes()
    original_rules = source[source.index('## 5 ·'.encode()):source.index('## 6 ·'.encode())]
    assert rules == original_rules, 'Section 5 changed'
    numbers = re.findall(rb'^(\d+)\. \*\*', rules, re.M)
    index = current[current.index('## 5 ·'.encode()):current.index('## 6 ·'.encode())]
    assert re.findall(rb'^(\d+)\. \*\*', index, re.M) == numbers, 'Rule order/numbers changed'
    assert index.count(b'** ' + '—'.encode() + b' `docs/team/rules.md`') == len(numbers)
    leads = re.findall(r'^\d+\. \*\*(.*?)\*\*', rules.decode('utf-8'), re.M | re.S)
    titles = re.findall(r'^\d+\. \*\*(.*?)\*\*', index.decode('utf-8'), re.M)
    for lead, title in zip(leads, titles):
        assert ' '.join(lead.split()).startswith(title), 'Title not taken from rule first words'
    assert len(current) < 150000 and len(current.decode('utf-8')) < 150000
    print(f'PASS: {len(manifest["moves"])} blocks; {len(assignments)} source line occurrences '
          f'assigned exactly once; all destination bytes unchanged; original reconstructed.')
    print(f'PASS: section 5 heading and all {len(numbers)} rule entries unchanged; index order preserved.')
    print(f'CLAUDE.md: {len(current.decode("utf-8"))} characters; {len(current)} bytes.')


if __name__ == '__main__':
    verify()
