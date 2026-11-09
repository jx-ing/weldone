"""TRI/2 SPF source entities and middle-assembly ownership.

SPF uses Part 21 record syntax but is not a STEP BRep schema. Keep field values
as source strings: geometry and manufacturing-code interpretation belong to
separate consumers. Explicit assembly membership determines welding boundaries.
Clip/bracket wrappers below the middle assembly do not make a small assembly;
each of their loose geometric leaves remains independently weldable.
"""
from __future__ import annotations

import argparse
import bisect
import collections
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re

from step_assembly import split_args, step_string as spf_string


LEAF_TYPES = frozenset(('plate', 'stiffener', 'flange'))
WRAPPER_TYPES = frozenset(('clip', 'bracket'))


def refs(value: str) -> list[int]:
    """Return references in field order, ignoring reference-like string text."""
    unquoted = re.sub(r"'[^']*(?:''[^']*)*'", '', value)
    return [int(v) for v in re.findall(r'#(\d+)\b', unquoted)]


def ref(value: str) -> int | None:
    match = re.fullmatch(r'#(\d+)', value.strip())
    return int(match[1]) if match else None


def _records(text: str):
    """Scan complete Part 21 entity records, including multiline/string values."""
    i, length = 0, len(text)
    declaration = re.compile(r'#(\d+)\s*=')
    while i < length:
        if text.startswith('/*', i):
            end = text.find('*/', i + 2)
            if end < 0:
                raise ValueError('Unterminated SPF comment')
            i = end + 2
            continue
        if text[i] == "'":
            i = _string_end(text, i)
            continue
        match = declaration.match(text, i) if text[i] == '#' else None
        if not match:
            i += 1
            continue
        start, entity_id, body_start = i, int(match[1]), match.end()
        i = body_start
        pieces, piece_start = [], i
        while i < length:
            if text[i] == "'":
                i = _string_end(text, i)
            elif text.startswith('/*', i):
                pieces.append(text[piece_start:i])
                end = text.find('*/', i + 2)
                if end < 0:
                    raise ValueError(f'Unterminated comment in SPF entity #{entity_id}')
                i = end + 2
                pieces.append(' ')
                piece_start = i
            elif text[i] == ';':
                pieces.append(text[piece_start:i])
                yield entity_id, ''.join(pieces).strip(), start, text[start:i + 1]
                i += 1
                break
            else:
                i += 1
        else:
            raise ValueError(f'Unterminated SPF entity #{entity_id}')


def _string_end(text: str, start: int) -> int:
    i = start + 1
    while i < len(text):
        if text[i] == "'":
            if i + 1 < len(text) and text[i + 1] == "'":
                i += 2
                continue
            return i + 1
        i += 1
    raise ValueError('Unterminated SPF string')


@dataclass(frozen=True)
class SPFLeaf:
    entity_id: int
    name: str
    type: str
    path: list[int]
    owner_key: str
    owner_name: str
    small_assembly_id: int | None

    @property
    def key(self) -> str:
        return 'spf:' + '/'.join(map(str, self.path))


class SPFDocument:
    """Parsed source records, ordered membership, and an auditable owner map."""

    def __init__(self, path: Path, source_bytes: bytes, schemas: list[str], entities: dict[int, dict]):
        self.path = path
        self.schemas = schemas
        self.entities = entities
        roots = [i for i, e in entities.items()
                 if e['type'] == 'assembly' and len(e['args']) > 7 and e['args'][7] == '$']
        if len(roots) != 1:
            raise ValueError(f'SPF must have exactly one root assembly, found {roots}')
        self.root_id = roots[0]
        self.root = entities[self.root_id]
        self._leaves: list[SPFLeaf] = []
        self.report = self._build_report(source_bytes)

    def children(self, entity_id: int) -> list[int]:
        """Keep every ordered membership reference, including missing targets."""
        entity = self.entities.get(entity_id)
        if entity is None:
            return []
        args, kind = entity['args'], entity['type']
        if kind == 'assembly':
            if len(args) < 8:
                raise ValueError(f'Incomplete SPF assembly #{entity_id}')
            return refs(args[5]) + refs(args[6])
        if kind in WRAPPER_TYPES:
            return refs(args[-1])
        return []

    def name(self, entity_id: int) -> str:
        entity = self.entities.get(entity_id)
        return spf_string(entity['args'][2]) if entity and len(entity['args']) > 2 else f'#{entity_id}'

    def leaf_members(self) -> list[SPFLeaf]:
        return list(self._leaves)

    def _build_report(self, source_bytes: bytes) -> dict:
        entities, root_id = self.entities, self.root_id
        missing_refs = [{'entity': i, 'reference': r, 'line': e['line']}
                        for i, e in entities.items() for r in e['refs'] if r not in entities]
        parent_mismatches = []

        def expand(entity_id, path, small_id, active):
            if entity_id in active:
                raise ValueError(f'Cyclic SPF assembly membership at #{entity_id}')
            entity = entities.get(entity_id)
            key = 'spf:' + '/'.join(map(str, path))
            node = {'path': key, 'parentPath': 'spf:' + '/'.join(map(str, path[:-1])) if len(path) > 1 else None,
                    'entity': entity_id, 'name': self.name(entity_id), 'depth': len(path) - 1,
                    'type': entity['type'] if entity else 'missing', 'missing': entity is None,
                    'isAssembly': bool(entity and entity['type'] == 'assembly'), 'children': []}
            if entity is None:
                node['expandedLeafCount'] = 0
                return node
            kind = entity['type']
            if kind in LEAF_TYPES:
                owner_key = f'spf:assembly:{root_id}/{small_id}' if small_id is not None else f'spf:leaf:{key[4:]}'
                leaf = SPFLeaf(entity_id, node['name'], kind, path, owner_key,
                               self.name(small_id) if small_id is not None else node['name'], small_id)
                self._leaves.append(leaf)
                node.update(ownerKey=leaf.owner_key, ownerName=leaf.owner_name,
                            smallAssemblyEntity=small_id, expandedLeafCount=1)
                return node
            if kind != 'assembly' and kind not in WRAPPER_TYPES:
                raise ValueError(f'Unsupported SPF membership type {kind!r} at #{entity_id}')
            children = self.children(entity_id)
            for child_id in children:
                child = entities.get(child_id)
                next_small = child_id if entity_id == root_id and child and child['type'] == 'assembly' else small_id
                if child and child['type'] == 'assembly' and ref(child['args'][7]) != entity_id:
                    parent_mismatches.append({'entity': child_id, 'declaredParent': ref(child['args'][7]),
                                              'membershipParent': entity_id})
                node['children'].append(expand(child_id, path + [child_id], next_small, active | {entity_id}))
            node['expandedLeafCount'] = sum(c['expandedLeafCount'] for c in node['children'])
            return node

        tree = expand(root_id, [root_id], None, set())
        leaf_counts = collections.Counter(l.entity_id for l in self._leaves)
        all_leaf_ids = {i for i, e in entities.items() if e['type'] in LEAF_TYPES}
        groups_by_key = {}
        # Include empty direct small assemblies in the audit, without inventing leaves.
        small_ids = [i for i in self.children(root_id)
                     if i in entities and entities[i]['type'] == 'assembly']
        for small_id in small_ids:
            owner_key = f'spf:assembly:{root_id}/{small_id}'
            groups_by_key[owner_key] = {'key': owner_key, 'name': self.name(small_id), 'entity': small_id,
                                        'isAssembly': True, 'leafCount': 0, 'members': [], 'entityMembers': []}
        for leaf in self._leaves:
            group = groups_by_key.setdefault(leaf.owner_key, {'key': leaf.owner_key, 'name': leaf.owner_name,
                                             'entity': leaf.entity_id, 'isAssembly': False,
                                             'leafCount': 0, 'members': [], 'entityMembers': []})
            group['leafCount'] += 1
            group['members'].append(leaf.key)
            group['entityMembers'].append(leaf.entity_id)
        groups = list(groups_by_key.values())
        excluded = sum(g['leafCount'] * (g['leafCount'] - 1) // 2 for g in groups)
        total = len(self._leaves)
        evidence_ids = {root_id, *small_ids, *(m['entity'] for m in missing_refs)}
        return {
            'source': str(self.path), 'bytes': len(source_bytes),
            'sha256': hashlib.sha256(source_bytes).hexdigest(), 'schema': self.schemas,
            'entityCount': len(entities), 'entityTypeCounts': dict(collections.Counter(e['type'] for e in entities.values())),
            'rootEntity': root_id, 'rootName': self.name(root_id),
            'sourceOrientation': spf_string(self.root['args'][14]) if len(self.root['args']) > 14 else None,
            'assemblyCount': sum(e['type'] == 'assembly' for e in entities.values()),
            'expandedLeafCount': total, 'uniqueLeafEntityCount': len(leaf_counts),
            'smallAssemblyCount': len(small_ids), 'looseLeafCount': sum(l.small_assembly_id is None for l in self._leaves),
            'missingReferences': missing_refs, 'parentMismatches': parent_mismatches,
            'unreachableLeafEntities': sorted(all_leaf_ids - set(leaf_counts)),
            'repeatedLeafMemberships': {str(i): n for i, n in leaf_counts.items() if n > 1},
            'groupingPolicy': {'scope': 'middle-assembly',
                'rule': 'Exclude pairs with equal owner keys.',
                'ownerBoundary': 'Direct child assembly entities; each loose geometric leaf owns itself.',
                'wrapperRule': 'Clip/bracket wrappers do not create small-assembly boundaries.',
                'containers': [{'key': f'spf:{root_id}', 'name': self.name(root_id), 'entity': root_id}]},
            'groups': groups, 'groupCount': len(groups), 'excludedInternalPairCount': excluded,
            'crossOwnerPairCount': total * (total - 1) // 2 - excluded, 'trees': [tree],
            'nativeWeldEntityCount': sum('weld' in e['type'] or 'seam' in e['type'] for e in entities.values()),
            'evidence': {str(i): {'line': entities[i]['line'], 'raw': entities[i]['raw']} for i in sorted(evidence_ids)},
        }


def read_spf(path: str | Path) -> SPFDocument:
    path = Path(path).resolve()
    source_bytes = path.read_bytes()
    try:
        text = source_bytes.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = source_bytes.decode('cp1252')
    schema = re.search(r'FILE_SCHEMA\s*\(\s*\((.*?)\)\s*\)\s*;', text, re.I | re.S)
    schemas = [spf_string(s) for s in split_args(schema[1])] if schema else []
    if not any(s.upper() == 'TRI/2' for s in schemas):
        raise ValueError('SPF schema must identify TRI/2; ordinary STEP BRep is a different format')
    newlines = [m.start() for m in re.finditer('\n', text)]
    entities = {}
    for entity_id, body, offset, raw in _records(text):
        if entity_id in entities:
            raise ValueError(f'Duplicate SPF entity #{entity_id}')
        match = re.fullmatch(r'(\w+)\s*\((.*)\)', body, re.S)
        if not match:
            raise ValueError(f'Unsupported SPF entity syntax at #{entity_id}')
        entities[entity_id] = {'id': entity_id, 'type': match[1].lower(), 'args': split_args(match[2]),
                               'refs': refs(match[2]), 'line': bisect.bisect_left(newlines, offset) + 1, 'raw': raw}
    return SPFDocument(path, source_bytes, schemas, entities)


def analyze(path: str | Path) -> dict:
    return read_spf(path).report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    result = json.dumps(analyze(args.source), ensure_ascii=False, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(result, encoding='utf-8')
    else:
        print(result)


if __name__ == '__main__':
    main()
