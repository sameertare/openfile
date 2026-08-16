import { describe, it, expect } from 'vitest';
import { renderSparklineSvg } from './sparkline';

describe('renderSparklineSvg', () => {
  it('renders an empty svg with fewer than 2 values', () => {
    const svg = renderSparklineSvg([10]);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('<path');
  });

  it('renders a path across the given values', () => {
    const svg = renderSparklineSvg([100, -100, 50]);
    expect(svg).toContain('<path');
    expect(svg).toMatch(/M \d/);
  });

  it('breaks the path at a null value', () => {
    const svg = renderSparklineSvg([100, null, -100]);
    const d = svg.match(/d="([^"]*)"/)![1];
    expect((d.match(/M/g) ?? []).length).toBe(2);
  });

  it('clamps extreme centipawn values to the chart bounds instead of overflowing', () => {
    const extreme = renderSparklineSvg([100000, -100000]);
    const normal = renderSparklineSvg([1000, -1000]); // already at the clamp boundary
    const dExtreme = extreme.match(/d="([^"]*)"/)![1];
    const dNormal = normal.match(/d="([^"]*)"/)![1];
    expect(dExtreme).toBe(dNormal);
  });

  it('draws a mark circle at markIndex when that position has a value', () => {
    const svg = renderSparklineSvg([10, 20, 30], { markIndex: 1 });
    expect(svg).toContain('<circle');
  });

  it('omits the mark circle when markIndex points at a null value', () => {
    const svg = renderSparklineSvg([10, null, 30], { markIndex: 1 });
    expect(svg).not.toContain('<circle');
  });

  it('uses the provided width/height for the viewBox', () => {
    const svg = renderSparklineSvg([1, 2], { width: 200, height: 50 });
    expect(svg).toContain('viewBox="0 0 200 50"');
  });
});
