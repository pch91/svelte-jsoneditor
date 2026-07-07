import { describe, expect, it } from 'vitest'
import {
  enumerateDirectory,
  type DirectoryHandle,
  type FileEntry,
  type FileHandle
} from './filesystem.js'

function makeFile(name: string): FileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => new File(['{}'], name)
  } as unknown as FileHandle
}

function makeDir(name: string, children: FileSystemHandle[]): DirectoryHandle {
  return {
    kind: 'directory',
    name,
    entries: async function* () {
      for (const child of children) {
        yield [child.name, child] as [string, FileSystemHandle]
      }
    }
  } as unknown as DirectoryHandle
}

function collectAll(entries: FileEntry[]): FileEntry[] {
  const all: FileEntry[] = []
  for (const entry of entries) {
    all.push(entry)
    if (entry.children) all.push(...collectAll(entry.children))
  }
  return all
}

describe('enumerateDirectory', () => {
  it('sorts directories before files, both alphabetically', async () => {
    const root = makeDir('root', [makeFile('b.json'), makeDir('a', []), makeFile('a.json')])

    const entries = await enumerateDirectory(root)

    expect(entries.map((e) => e.name)).toEqual(['a', 'a.json', 'b.json'])
    expect(entries.map((e) => e.kind)).toEqual(['dir', 'file', 'file'])
  })

  it('nests children with full paths', async () => {
    const root = makeDir('root', [makeDir('sub', [makeFile('x.json'), makeFile('y.json')])])

    const entries = await enumerateDirectory(root)

    expect(entries.length).toBe(1)
    expect(entries[0].path).toBe('sub')
    expect(entries[0].children?.map((c) => c.path)).toEqual(['sub/x.json', 'sub/y.json'])
    expect(entries[0].expanded).toBe(false)
  })

  it('stops enumerating beyond the maximum depth', async () => {
    // build a chain of directories 10 levels deep with a file at the bottom
    let handle: FileSystemHandle = makeFile('deep.json')
    for (let depth = 0; depth < 10; depth++) {
      handle = makeDir(`d${depth}`, [handle])
    }

    const entries = await enumerateDirectory(handle as DirectoryHandle)

    const all = collectAll(entries)
    expect(all.some((e) => e.name === 'deep.json')).toBe(false)
    expect(all.length).toBeGreaterThan(0) // some directories were enumerated
  })

  it('caps the number of enumerated files', async () => {
    const files = Array.from({ length: 600 }, (_, i) => makeFile(`f${i}.json`))
    const root = makeDir('root', files)

    const entries = await enumerateDirectory(root)

    expect(entries.filter((e) => e.kind === 'file').length).toBeLessThanOrEqual(500)
  })
})
