import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../stores/app';

export function useWebSocket() {
  const { setMetrics, setWsStatus, setWsError, wsStatus } = useStore();
  const metricsWsRef = useRef<WebSocket | null>(null);
  const healthWsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectMetrics = useCallback(() => {
    if (metricsWsRef.current?.readyState === WebSocket.OPEN) return;
    
    setWsStatus({ metrics: 'connecting' });
    const ws = new WebSocket(`ws://${window.location.host}/ws/metrics`);
    
    ws.onopen = () => {
      setWsStatus({ metrics: 'connected' });
      setWsError(null);
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'metrics' && message.data) {
          setMetrics(message.data);
        }
      } catch (err) {
        console.error('Failed to parse metrics WebSocket message:', err);
      }
    };
    
    ws.onerror = () => {
      setWsStatus({ metrics: 'disconnected' });
    };
    
    ws.onclose = () => {
      setWsStatus({ metrics: 'disconnected' });
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connectMetrics, 3000);
    };
    
    metricsWsRef.current = ws;
  }, [setMetrics, setWsStatus, setWsError]);

  const connectHealth = useCallback(() => {
    if (healthWsRef.current?.readyState === WebSocket.OPEN) return;
    
    setWsStatus({ health: 'connecting' });
    const ws = new WebSocket(`ws://${window.location.host}/ws/health`);
    
    ws.onopen = () => {
      setWsStatus({ health: 'connected' });
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'health' && message.data) {
          // We could update provider health status here if needed
          // For now, we fetch full provider list via HTTP
        }
      } catch (err) {
        console.error('Failed to parse health WebSocket message:', err);
      }
    };
    
    ws.onerror = () => {
      setWsStatus({ health: 'disconnected' });
    };
    
    ws.onclose = () => {
      setWsStatus({ health: 'disconnected' });
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connectHealth, 3000);
    };
    
    healthWsRef.current = ws;
  }, [setWsStatus]);

  useEffect(() => {
    connectMetrics();
    connectHealth();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      metricsWsRef.current?.close();
      healthWsRef.current?.close();
    };
  }, [connectMetrics, connectHealth]);

  return { wsStatus };
}
