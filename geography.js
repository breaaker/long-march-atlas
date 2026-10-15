// Geographic names are independent of the selected army and the historical clock.
export class GeographyLayer {
  constructor(parent, dataset) {
    this.dataset = dataset;
    this.layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.layer.id = 'landmarks-layer';
    parent.append(this.layer);
    this.items = [...dataset.landmarks, ...(dataset.riverLabels || [])].map(place => {
      const make = (tag, attrs, target = this.layer) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
        target.append(el);
        return el;
      };
      const group = make('g', {class: `geo-landmark ${place.type === 'river' ? 'geo-river' : ''}`, 'data-landmark': place.id, tabindex: 0, role: 'button', 'aria-label': `${place.name} · 查看相关历史`});
      const title = make('title', {}, group);
      title.textContent = place.name + ' · ' + (place.notes || '现代位置参考');
      const leader = make('path', {class: 'geo-leader'}, group);
      const dot = make('circle', {r: place.type === 'river' ? 0 : 2.5, class: 'geo-dot'}, group);
      const label = make('text', {class: 'geo-label', y: 4}, group);
      label.textContent = place.displayName || place.name;
      return {place, group, leader, dot, label};
    });
  }

  update({camera, width, height, selectedId, reserved = [], riversVisible = true, landmarksVisible = true}) {
    const key = JSON.stringify([camera, width, height, selectedId, reserved, riversVisible, landmarksVisible]);
    if (key === this.lastKey) return this.occupied || [];
    this.lastKey = key;
    if (!landmarksVisible) { this.occupied = []; return []; }
    const k = camera.height / height;
    const project = p => [(p.lon - 96) * 55, (40 - p.lat) * 64];
    const left = camera.cx - width * k / 2, top = camera.cy - height * k / 2;
    const occupied = reserved.map(r => ({...r}));
    const labels = [];
    const overlap = (a, b) => a.x < b.x + b.w + 4 && a.x + a.w + 4 > b.x && a.y < b.y + b.h + 3 && a.y + a.h + 3 > b.y;
    const sorted = [...this.items].sort((a, b) => Number(b.place.eventIds?.includes(selectedId)) - Number(a.place.eventIds?.includes(selectedId)) || a.place.priority - b.place.priority || Number(b.place.type === 'river') - Number(a.place.type === 'river'));
    for (const item of sorted) {
      const {place, group, label, leader} = item;
      if (place.type === 'river' && !riversVisible) { group.setAttribute('visibility','hidden'); continue; }
      const [wx, wy] = project(place), sx = (wx - left) / k, sy = (wy - top) / k;
      const selected = place.eventIds?.includes(selectedId);
      const eligible = place.priority === 1 || camera.height <= (place.maxHeight || 650) || selected;
      const onScreen = sx > 8 && sx < width - 8 && sy > 15 && sy < height - 10;
      group.setAttribute('visibility', eligible && onScreen ? 'visible' : 'hidden');
      if (!eligible || !onScreen) continue;
      group.classList.toggle('related', !!selected);
      group.setAttribute('transform', `translate(${wx},${wy}) scale(${k})`);
      const w = (place.displayName || place.name).length * (place.type === 'river' ? 12.5 : 12) + 2;
      const offsets = [[8,-9],[8,14],[-w-8,-9],[-w-8,14],[-w/2,-18],[-w/2,23],[20,-27],[-w-20,32],[28,2],[-w-28,2],[8,-40],[8,44]];
      const candidates = offsets.map(([dx,dy]) => ({x:sx+dx-2,y:sy+dy-10,w:w+4,h:16,dx,dy}));
      let position = candidates.find(r => r.x >= 6 && r.x + r.w <= width - 6 && r.y >= 8 && r.y + r.h <= height - 6 && !occupied.some(p => overlap(r,p)));
      const crossingDetail = camera.height <= 230 && /^crossing-(tucheng|yuanhou|taiping|erlang|maotai|jiuxikou)$/.test(place.id);
      if (!position && place.priority !== 1 && !selected && !crossingDetail) {
        // Keep the dot available; its name unfolds on zoom or keyboard focus.
        label.setAttribute('visibility','hidden');
        leader.setAttribute('d','');
        continue;
      }
      if (!position) {
        position = candidates.filter(r => r.x >= 6 && r.x+r.w <= width-6 && r.y >= 8 && r.y+r.h <= height-6).sort((a,b) => occupied.filter(p=>overlap(a,p)).length-occupied.filter(p=>overlap(b,p)).length)[0] || candidates[0];
      }
      label.setAttribute('visibility','visible');
      label.setAttribute('x',position.dx);
      label.setAttribute('y',position.dy+4);
      leader.setAttribute('d',Math.abs(position.dx)>18 || Math.abs(position.dy)>22 ? `M0,0L${position.dx < 0 ? position.dx+w : position.dx},${position.dy}` : '');
      occupied.push(position);
      labels.push(position);
    }
    this.occupied = labels;
    return labels;
  }
}
