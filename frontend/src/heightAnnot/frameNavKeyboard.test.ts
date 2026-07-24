import { describe, expect, it } from 'vitest'
import {
  frameNavKeyDelta,
  shouldClearFrameSelection,
  shouldSaveAnnotation,
  shouldToggleAthleteProperty,
  shouldToggleFrameSelection,
  shouldToggleSplashProperty,
} from './frameNavKeyboard'

describe('frameNavKeyboard', () => {
  it('maps ArrowLeft to -1', () => {
    expect(frameNavKeyDelta('ArrowLeft')).toBe(-1)
  })

  it('maps ArrowRight to +1', () => {
    expect(frameNavKeyDelta('ArrowRight')).toBe(1)
  })

  it('ignores other keys', () => {
    expect(frameNavKeyDelta('Enter')).toBe(0)
    expect(frameNavKeyDelta('a')).toBe(0)
  })

  it('ignores keys when typing in input', () => {
    expect(frameNavKeyDelta('ArrowLeft', { tagName: 'INPUT' })).toBe(0)
    expect(frameNavKeyDelta('ArrowLeft', { tagName: 'TEXTAREA' })).toBe(0)
  })

  it('Space toggles frame selection', () => {
    expect(shouldToggleFrameSelection(' ')).toBe(true)
    expect(shouldToggleFrameSelection('Spacebar')).toBe(true)
  })

  it('Space ignored in input', () => {
    expect(shouldToggleFrameSelection(' ', { tagName: 'INPUT' })).toBe(false)
  })

  it('other keys do not toggle selection', () => {
    expect(shouldToggleFrameSelection('Enter')).toBe(false)
    expect(shouldToggleFrameSelection('a')).toBe(false)
  })

  it('s triggers save', () => {
    expect(shouldSaveAnnotation('s')).toBe(true)
    expect(shouldSaveAnnotation('S')).toBe(false)
  })

  it('c triggers clear selection', () => {
    expect(shouldClearFrameSelection('c')).toBe(true)
    expect(shouldClearFrameSelection('C')).toBe(false)
  })

  it('s and c ignored in input and with modifiers', () => {
    expect(shouldSaveAnnotation('s', { tagName: 'INPUT' })).toBe(false)
    expect(shouldClearFrameSelection('c', { tagName: 'TEXTAREA' })).toBe(false)
    expect(shouldSaveAnnotation('s', null, { ctrlKey: true })).toBe(false)
    expect(shouldClearFrameSelection('c', null, { metaKey: true })).toBe(false)
  })

  it('W and A toggle frame properties', () => {
    expect(shouldToggleSplashProperty('w')).toBe(true)
    expect(shouldToggleSplashProperty('W')).toBe(true)
    expect(shouldToggleAthleteProperty('a')).toBe(true)
    expect(shouldToggleAthleteProperty('A')).toBe(true)
  })

  it('W and A property toggles are ignored in input and with modifiers', () => {
    expect(shouldToggleSplashProperty('w', { tagName: 'INPUT' })).toBe(false)
    expect(shouldToggleAthleteProperty('a', { tagName: 'TEXTAREA' })).toBe(false)
    expect(shouldToggleSplashProperty('w', null, { ctrlKey: true })).toBe(false)
    expect(shouldToggleAthleteProperty('a', null, { altKey: true })).toBe(false)
  })
})
