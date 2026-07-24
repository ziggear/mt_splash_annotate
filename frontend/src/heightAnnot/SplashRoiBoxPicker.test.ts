// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SplashRoiBoxPicker from './SplashRoiBoxPicker'
import { framePointToPaint, measurePaintLayout } from './overlayCoords'

function mockImageLayout() {
  const img = screen.getByAltText('ROI annotation frame') as HTMLImageElement
  Object.defineProperty(img, 'offsetWidth', { configurable: true, value: 400 })
  Object.defineProperty(img, 'offsetHeight', { configurable: true, value: 300 })
  img.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  fireEvent.load(img)
}

describe('SplashRoiBoxPicker', () => {
  afterEach(() => cleanup())

  it('moves roi without changing line callbacks', () => {
    const onRoiChange = vi.fn()
    const onWaterYChange = vi.fn()
    const onSplashTopYChange = vi.fn()
    render(
      createElement(SplashRoiBoxPicker, {
        imageUrl: '/frame.jpg',
        frameWidth: 1920,
        frameHeight: 1080,
        roi: [310, 300, 545, 670],
        previousRoi: null,
        onRoiChange,
        onReset: vi.fn(),
        onCopyPrevious: vi.fn(),
        onWaterYChange,
        onSplashTopYChange,
      }),
    )
    mockImageLayout()

    const box = screen.getByTestId('splash-roi-box')
    fireEvent.pointerDown(box, { clientX: 90, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(box, { clientX: 110, clientY: 120, pointerId: 1 })
    fireEvent.pointerUp(box, { pointerId: 1 })

    expect(onRoiChange).toHaveBeenCalled()
    expect(onWaterYChange).not.toHaveBeenCalled()
    expect(onSplashTopYChange).not.toHaveBeenCalled()
  })

  it('resets and copies previous roi', () => {
    const onReset = vi.fn()
    const onCopyPrevious = vi.fn()
    render(
      createElement(SplashRoiBoxPicker, {
        imageUrl: '/frame.jpg',
        frameWidth: 1920,
        frameHeight: 1080,
        roi: [310, 300, 545, 670],
        previousRoi: [300, 290, 540, 660],
        onRoiChange: vi.fn(),
        onReset,
        onCopyPrevious,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reset ROI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Previous ROI' }))

    expect(onReset).toHaveBeenCalledTimes(1)
    expect(onCopyPrevious).toHaveBeenCalledTimes(1)
  })

  it('resizes the right edge without moving the left edge', () => {
    const onRoiChange = vi.fn()
    render(
      createElement(SplashRoiBoxPicker, {
        imageUrl: '/frame.jpg',
        frameWidth: 1920,
        frameHeight: 1080,
        roi: [310, 300, 545, 670],
        previousRoi: null,
        onRoiChange,
        onReset: vi.fn(),
        onCopyPrevious: vi.fn(),
      }),
    )
    mockImageLayout()

    const layout = measurePaintLayout(400, 300, 1920, 1080)!
    const start = framePointToPaint({ x: 545, y: 480 }, layout)
    const end = framePointToPaint({ x: 600, y: 480 }, layout)
    const handle = screen.getByTestId('splash-roi-handle-e')
    fireEvent.pointerDown(handle, { clientX: start.left, clientY: start.top, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: end.left, clientY: end.top, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(onRoiChange).toHaveBeenLastCalledWith([310, 300, 600, 670])
  })

  it('resizes the top-left corner', () => {
    const onRoiChange = vi.fn()
    render(
      createElement(SplashRoiBoxPicker, {
        imageUrl: '/frame.jpg',
        frameWidth: 1920,
        frameHeight: 1080,
        roi: [310, 300, 545, 670],
        previousRoi: null,
        onRoiChange,
        onReset: vi.fn(),
        onCopyPrevious: vi.fn(),
      }),
    )
    mockImageLayout()

    const layout = measurePaintLayout(400, 300, 1920, 1080)!
    const start = framePointToPaint({ x: 310, y: 300 }, layout)
    const end = framePointToPaint({ x: 280, y: 260 }, layout)
    const handle = screen.getByTestId('splash-roi-handle-nw')
    fireEvent.pointerDown(handle, { clientX: start.left, clientY: start.top, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: end.left, clientY: end.top, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(onRoiChange).toHaveBeenLastCalledWith([280, 260, 545, 670])
  })
})
