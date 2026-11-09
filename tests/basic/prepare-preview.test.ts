// Basic slicer UX: any edit after slicing sends you back to Prepare; Export only on Preview.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { useStore } from '../../src/state/store';

const sliced = () => useStore.setState({ workspace: 'preview', slice: { ...useStore.getState().slice, status: 'done', dirty: false } });

describe('edit after slicing returns to Prepare', () => {
  const edits: [string, () => void][] = [
    ['objects changed', () => useStore.setState({ objects: [...useStore.getState().objects] })],
    ['process override changed', () => useStore.setState({ overrides: { ...useStore.getState().overrides, wall_loops: 4 } })],
    ['preset changed', () => useStore.setState({ presetId: '0.12' })],
    ['printer changed', () => useStore.setState({ printerId: 'bbl-a1' })],
    ['filaments changed', () => useStore.setState({ filaments: [...useStore.getState().filaments] })],
    ['plate type changed', () => useStore.setState({ plate: 'cool_plate' as never })],
  ];
  for (const [name, edit] of edits) it(name, () => {
    sliced();
    edit();
    expect(useStore.getState().workspace).toBe('prepare');
    expect(useStore.getState().slice.dirty).toBe(true);
  });
  it('view-only changes keep Preview', () => {
    sliced();
    useStore.setState({ colorScheme: useStore.getState().colorScheme, showEdges: true });
    expect(useStore.getState().workspace).toBe('preview');
  });
  it('slicing itself does not bounce out of Preview', () => {
    useStore.setState({ workspace: 'preview', slice: { ...useStore.getState().slice, status: 'slicing' } });
    useStore.setState({ objects: [...useStore.getState().objects] });
    expect(useStore.getState().workspace).toBe('preview');
  });
});

describe('Export G-code is a Preview-only action', () => {
  it('the action dock only offers Export on Preview', () => {
    const src = readFileSync('src/ui/shell/ActionDock.tsx', 'utf8');
    expect(src).toMatch(/const ready = sum\.ready && !busy && workspace === 'preview'/);
  });
});
