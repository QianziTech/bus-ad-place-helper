import { init, registerMap, use, type ComposeOption } from 'echarts/core'
import { LinesChart, ScatterChart, type LinesSeriesOption, type ScatterSeriesOption } from 'echarts/charts'
import { GeoComponent, TooltipComponent, type GeoComponentOption, type TooltipComponentOption } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
// 阿里云 DataV.GeoAtlas（GCJ-02），上海市 310000 与下辖 16 区 310000_full。
import shanghaiOutline from './maps/shanghai-outline.json'
import shanghaiDistricts from './maps/shanghai-districts.json'

type Point = [number, number]

export interface CoverageMapData {
  routes: { name: string; coords: Point[]; quantity: number; color: string }[]
  pois: { name: string; coord: Point }[]
}

type MapOption = ComposeOption<GeoComponentOption | TooltipComponentOption | LinesSeriesOption | ScatterSeriesOption>

use([GeoComponent, TooltipComponent, LinesChart, ScatterChart, SVGRenderer])
registerMap('outline', JSON.stringify(shanghaiOutline))
registerMap('districts', JSON.stringify(shanghaiDistricts))

function routeBounds({ routes, pois }: CoverageMapData) {
  const points = routes.flatMap(route => route.coords).concat(pois.map(poi => poi.coord))
  const lngs = points.map(([lng]) => lng)
  const lats = points.map(([, lat]) => lat)
  const west = Math.min(...lngs)
  const east = Math.max(...lngs)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const lngPadding = Math.max((east - west) * 0.08, 0.003)
  const latPadding = Math.max((north - south) * 0.08, 0.003)
  return [[west - lngPadding, north + latPadding], [east + lngPadding, south - latPadding]]
}

function mountCoverageMap(section: HTMLElement) {
  const panel = section.querySelector<HTMLElement>('[data-coverage-map]')!
  const canvas = panel.querySelector<HTMLElement>('[data-map-canvas]')!
  const layer = panel.querySelector<HTMLSelectElement>('[data-map-layer]')!
  const scope = panel.querySelector<HTMLSelectElement>('[data-map-scope]')!
  let chart: ReturnType<typeof init> | undefined

  function render() {
    const payload = section.querySelector('[data-map-data]')?.textContent
    panel.hidden = !payload
    if (!payload) return

    const data: CoverageMapData = JSON.parse(payload)
    const districts = layer.value === 'districts'
    chart ??= init(canvas, null, { renderer: 'svg' })
    const option: MapOption = {
      animation: false,
      tooltip: { trigger: 'item', renderMode: 'richText', formatter: '{b}', confine: true },
      geo: {
        map: districts ? 'districts' : 'outline',
        boundingCoords: scope.value === 'routes' ? routeBounds(data) : undefined,
        left: 12, right: 12, top: 12, bottom: 12,
        itemStyle: { areaColor: '#f9faf9', borderColor: '#9aa9ae', borderWidth: 1 },
        tooltip: { show: districts },
        emphasis: { disabled: true },
        silent: !districts,
      },
      series: [
        {
          type: 'lines', coordinateSystem: 'geo', polyline: true,
          lineStyle: { opacity: 0.9, cap: 'round', join: 'round' },
          data: data.routes.map(route => ({
            name: `${route.name} ×${route.quantity}`,
            coords: route.coords,
            lineStyle: { color: route.color, width: Math.min(5, 2 + Math.ceil(route.quantity / 3)) },
          })),
        },
        {
          type: 'scatter', coordinateSystem: 'geo', symbolSize: 16, z: 3,
          itemStyle: { color: '#344553', borderColor: '#fff', borderWidth: 1 },
          label: { show: true, position: 'inside', color: '#fff', fontSize: 10, formatter: item => String(item.dataIndex + 1) },
          data: data.pois.map(poi => ({ name: poi.name, value: poi.coord })),
        },
      ],
    }
    chart.setOption(option, { notMerge: true })
  }

  layer.addEventListener('change', render)
  scope.addEventListener('change', render)
  document.addEventListener('plan-map-update', render)
  new ResizeObserver(() => {
    if (!panel.hidden) chart?.resize()
  }).observe(canvas)
  render()
}

const section = document.querySelector<HTMLElement>('#s7map')
if (section) mountCoverageMap(section)
