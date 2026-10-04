// Clear only FAT12 free clusters; preserve geometry, allocated sectors and metadata.
// Packaging uses this separately so loading an existing save does not rewrite it.
export function zeroFreeClusters(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = at => view.getUint16(at, true);
  const u32 = at => view.getUint32(at, true);
  const header = u32(8), sector = u32(16), spt = u32(20), heads = u32(24);
  const part = header + sector;
  const base = header + ((u16(part + 10) * heads + data[part + 9]) * spt + data[part + 8]) * sector;
  const bps = u16(base + 11), clusterSize = bps * data[base + 13];
  const fatSize = u16(base + 22) * bps, fatCount = data[base + 16];
  const fat = base + u16(base + 14) * bps;
  const root = fat + fatCount * fatSize;
  const clusters = root + Math.ceil(u16(base + 17) * 32 / bps) * bps;
  const end = base + (u16(base + 19) || u32(base + 32)) * bps;
  const count = Math.floor((end - clusters) / clusterSize);
  if (!bps || !clusterSize || fatCount < 1 || count < 1 || count >= 4085 || end > data.length ||
      Math.floor((count + 1) * 3 / 2) + 2 > fatSize) throw new Error('无效的 FAT12 镜像边界');
  for (let copy = 1; copy < fatCount; copy++) {
    for (let i = 0; i < fatSize; i++) {
      if (data[fat + i] !== data[fat + copy * fatSize + i]) throw new Error('FAT 副本不一致');
    }
  }
  for (let c = 2; c < count + 2; c++) {
    const value = u16(fat + Math.floor(c * 3 / 2));
    if ((c & 1 ? value >> 4 : value & 0xfff) === 0) {
      const start = clusters + (c - 2) * clusterSize;
      data.fill(0, start, start + clusterSize);
    }
  }
}

// The bundled HDIs use a PC-98 partition table and FAT12 filesystem.
// Preserve the selected game's sectors (including scores) while removing others.
export function isolateDisk(data, gameDir, marker) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = at => view.getUint16(at, true);
  const u32 = at => view.getUint32(at, true);
  const header = u32(8), sector = u32(16), spt = u32(20), heads = u32(24);
  const part = header + sector;
  const base = header + ((u16(part + 10) * heads + data[part + 9]) * spt + data[part + 8]) * sector;
  const bps = u16(base + 11), clusterSize = bps * data[base + 13];
  const fatSize = u16(base + 22) * bps, fatCount = data[base + 16];
  const fat = base + u16(base + 14) * bps;
  const root = fat + fatCount * fatSize, entries = u16(base + 17);
  const clusters = root + Math.ceil(entries * 32 / bps) * bps;
  const offset = cluster => clusters + (cluster - 2) * clusterSize;
  function chain(cluster) {
    const found = new Set();
    while (cluster >= 2 && cluster < 0xff8) {
      if (found.has(cluster) || offset(cluster) + clusterSize > data.length) throw new Error('镜像 FAT 链损坏');
      found.add(cluster);
      const value = u16(fat + Math.floor(cluster * 3 / 2));
      cluster = cluster & 1 ? value >> 4 : value & 0xfff;
    }
    return [...found];
  }
  const decoder = new TextDecoder();
  function directory(start, count) {
    const result = [];
    for (let at = start; at < start + count * 32; at += 32) {
      if (!data[at]) break;
      if (data[at] === 0xe5 || data[at + 11] === 15) continue;
      result.push({at, name: decoder.decode(data.subarray(at, at + 8)).trim(),
        attr: data[at + 11], cluster: u16(at + 26)});
    }
    return result;
  }
  function remove(entry) {
    const allocated = chain(entry.cluster);
    if (entry.attr & 16) {
      for (const cluster of allocated) {
        for (const child of directory(offset(cluster), clusterSize / 32)) {
          if (child.name !== '.' && child.name !== '..') remove(child);
        }
      }
    }
    for (const cluster of allocated) {
      for (let copy = 0; copy < fatCount; copy++) {
        const at = fat + copy * fatSize + Math.floor(cluster * 3 / 2);
        view.setUint16(at, u16(at) & (cluster & 1 ? 0x000f : 0xf000), true);
      }
      data.fill(0, offset(cluster), offset(cluster) + clusterSize);
    }
    data[entry.at] = 0xe5;
  }
  const rootEntries = directory(root, entries);
  if (!rootEntries.some(e => e.name === gameDir && (e.attr & 16))) throw new Error('镜像中没有当前作品');
  const gameDirs = ['REIIDEN', 'HUMAROKU', 'YUMEZIKU', 'GENSO', 'KAIKI'];
  for (const entry of rootEntries) {
    if ((gameDirs.includes(entry.name) && entry.name !== gameDir) || entry.name === 'GDC25') remove(entry);
  }
  const label = rootEntries.find(e => e.attr === 8);
  if (!label || marker.length !== 8) throw new Error('镜像卷标无效');
  data.fill(32, label.at, label.at + 11);
  data.set(new TextEncoder().encode(marker), label.at);
  return label.at;
}
