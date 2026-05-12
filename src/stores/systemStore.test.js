import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSystemStore } from './systemStore';

describe('systemStore', () => {
  beforeEach(() => {
    // Reset store state before each test if necessary
    useSystemStore.setState({ 
      isConnected: false, 
      viewerCount: 0,
      liveTitle: "รอรับกระแสข้อมูล..." 
    });
  });

  it('should update connection status', () => {
    const { setIsConnected } = useSystemStore.getState();
    setIsConnected(true);
    expect(useSystemStore.getState().isConnected).toBe(true);
  });

  it('should update viewer count', () => {
    const { setViewerCount } = useSystemStore.getState();
    setViewerCount(150);
    expect(useSystemStore.getState().viewerCount).toBe(150);
  });

  it('should update live title', () => {
    const { setLiveTitle } = useSystemStore.getState();
    setLiveTitle("Test Stream");
    expect(useSystemStore.getState().liveTitle).toBe("Test Stream");
  });
});
