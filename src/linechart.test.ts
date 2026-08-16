import { describe, it, expect } from 'vitest';
import { renderLineChartSvg, type ChartSeries } from './linechart';

describe('renderLineChartSvg', () => {
  it('renders a fallback message when there is no numeric data at all', () => {
    const html = renderLineChartSvg([{ label: 'A', values: [null, null], color: '#fff' }]);
    expect(html).toContain('Not enough data to chart yet.');
    expect(html).not.toContain('<svg');
  });

  it('renders an svg with one path per series', () => {
    const series: ChartSeries[] = [
      { label: 'A', values: [10, 20, 30], color: 'red' },
      { label: 'B', values: [5, 15, 25], color: 'blue' },
    ];
    const html = renderLineChartSvg(series);
    expect(html).toContain('<svg');
    expect((html.match(/<path/g) ?? []).length).toBe(2);
    expect(html).toContain('stroke="red"');
    expect(html).toContain('stroke="blue"');
  });

  it('shows a legend only when there is more than one series', () => {
    const one = renderLineChartSvg([{ label: 'Solo', values: [1, 2], color: 'red' }]);
    expect(one).not.toContain('chart-legend');
    const two = renderLineChartSvg([
      { label: 'A', values: [1, 2], color: 'red' },
      { label: 'B', values: [1, 2], color: 'blue' },
    ]);
    expect(two).toContain('chart-legend');
    expect(two).toContain('A');
    expect(two).toContain('B');
  });

  it('breaks the path at a null value (gap in data) rather than interpolating across it', () => {
    const html = renderLineChartSvg([{ label: 'A', values: [10, null, 30], color: 'red' }]);
    const pathMatch = html.match(/<path d="([^"]*)"/)!;
    // Two separate "M" (moveto) commands means the line was split into two segments, not joined.
    expect((pathMatch[1].match(/M/g) ?? []).length).toBe(2);
  });

  it('respects explicit yMin/yMax rather than deriving them from the data', () => {
    const html = renderLineChartSvg([{ label: 'A', values: [50], color: 'red' }], { yMin: 0, yMax: 100 });
    expect(html).toContain('>0<');
    expect(html).toContain('>100<');
  });

  it('appends the ySuffix to axis labels', () => {
    const html = renderLineChartSvg([{ label: 'A', values: [50], color: 'red' }], { yMin: 0, yMax: 100, ySuffix: '%' });
    expect(html).toContain('100%<');
  });

  it('renders x-axis labels, always including the last one', () => {
    const html = renderLineChartSvg(
      [{ label: 'A', values: [1, 2, 3, 4, 5], color: 'red' }],
      { xLabels: ['d1', 'd2', 'd3', 'd4', 'd5'] }
    );
    expect(html).toContain('d5');
  });
});
