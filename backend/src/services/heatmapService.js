import { col } from '../config/db.js';

const X_BUCKETS = 50; // x stored as ‰ of document width → 50 columns of 20‰
const Y_BUCKET_PX = 25;

/** Pages that have heatmap data, most clicked first. */
export function heatmapPages({ websiteIds, range }) {
  return col('heatmapPoints').aggregate([
    { $match: { websiteId: { $in: websiteIds }, ts: { $gte: range.from, $lte: range.to } } },
    { $group: { _id: { w: '$websiteId', p: '$path' }, clicks: { $sum: { $cond: [{ $eq: ['$kind', 'click'] }, 1, 0] } }, rage: { $sum: { $cond: [{ $eq: ['$kind', 'rage'] }, 1, 0] } }, dead: { $sum: { $cond: [{ $eq: ['$kind', 'dead'] }, 1, 0] } } } },
    { $sort: { clicks: -1 } },
    { $limit: 200 },
    { $project: { _id: 0, websiteId: { $toString: '$_id.w' }, path: '$_id.p', clicks: 1, rage: 1, dead: 1 } },
  ]).toArray();
}

/** Density grid + popular elements + scroll reach for one page. */
export async function heatmapData({ websiteIds, range }, { path, device }) {
  const match = { websiteId: { $in: websiteIds }, path, ts: { $gte: range.from, $lte: range.to }, ...(device ? { vw: device } : {}) };
  const [f] = await col('heatmapPoints').aggregate([
    { $match: match },
    { $facet: {
      grid: [
        { $group: { _id: { x: { $floor: { $divide: ['$x', 1000 / X_BUCKETS] } }, y: { $floor: { $divide: ['$y', Y_BUCKET_PX] } }, k: '$kind' }, n: { $sum: 1 } } },
        { $limit: 20_000 },
      ],
      elements: [
        { $match: { sel: { $ne: null } } },
        { $group: { _id: '$sel', clicks: { $sum: { $cond: [{ $eq: ['$kind', 'click'] }, 1, 0] } }, rage: { $sum: { $cond: [{ $eq: ['$kind', 'rage'] }, 1, 0] } }, dead: { $sum: { $cond: [{ $eq: ['$kind', 'dead'] }, 1, 0] } } } },
        { $addFields: { total: { $add: ['$clicks', '$rage', '$dead'] } } },
        { $sort: { total: -1 } },
        { $limit: 30 },
      ],
      maxY: [{ $group: { _id: null, y: { $max: '$y' } } }],
    } },
  ]).toArray();

  const scroll = await col('pageViews').aggregate([
    { $match: { websiteId: { $in: websiteIds }, path, ts: { $gte: range.from, $lte: range.to } } },
    { $bucket: { groupBy: '$maxScroll', boundaries: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 101], default: 'other', output: { n: { $sum: 1 } } } },
  ]).toArray();
  const totalViews = scroll.reduce((s, b) => s + b.n, 0);
  // Reach: share of page views that scrolled at least X%.
  const reach = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((depth) => ({
    depth,
    pct: totalViews ? Math.round((scroll.filter((b) => typeof b._id === 'number' && b._id >= depth).reduce((s, b) => s + b.n, 0) / totalViews) * 1000) / 10 : 0,
  }));

  return {
    xBuckets: X_BUCKETS,
    yBucketPx: Y_BUCKET_PX,
    maxY: f.maxY[0]?.y || 0,
    points: f.grid.map((g) => ({ x: g._id.x, y: g._id.y, kind: g._id.k, n: g.n })),
    elements: f.elements.map((e) => ({ selector: e._id, clicks: e.clicks, rage: e.rage, dead: e.dead })),
    scroll: { pageviews: totalViews, reach },
  };
}
