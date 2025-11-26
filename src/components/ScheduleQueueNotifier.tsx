import React, { useState, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { getToken, approveQueueItem, rejectQueueItem } from '../services/api';

interface QueuePayload {
  queueId: string;
  name?: string;
  startTime?: string;
  endTime?: string;
}

const ScheduleQueueNotifier: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    let unsub: (() => void) | null = null;
    (async () => {
      const wsClient = (await import('../services/wsClient')).default;
      wsClient.connectIfNeeded(token);
      unsub = wsClient.subscribe('userLog', (data: any) => {
        try {
          if (data.log && data.log.type === 'external_schedule_request') {
            setPayload(data.log.payload || null);
            setOpen(true);
          }
        } catch (e) {}
      });
    })();

    return () => { if (unsub) unsub(); };
  }, []);

  const handleApprove = async () => {
    if (!payload) return;
    try {
      await approveQueueItem(payload.queueId);
      setOpen(false);
    } catch (e) {
      console.error('Approve failed', e);
    }
  };

  const handleReject = async () => {
    if (!payload) return;
    try {
      await rejectQueueItem(payload.queueId);
      setOpen(false);
    } catch (e) {
      console.error('Reject failed', e);
    }
  };

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} title="外部日程请求">
      {payload ? (
        <div>
          <p><strong>请求标题：</strong>{payload.name}</p>
          <p><strong>开始：</strong>{payload.startTime}</p>
          <p><strong>结束：</strong>{payload.endTime}</p>
          <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={handleReject}>拒绝</Button>
            <Button onClick={handleApprove}>允许并添加</Button>
          </div>
        </div>
      ) : (
        <div>收到外部日程请求</div>
      )}
    </Modal>
  );
};

export default ScheduleQueueNotifier;
