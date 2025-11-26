import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { getScheduleQueue, approveQueueItem, rejectQueueItem } from '../../services/api';
import type { ScheduleQueueItem } from '../../services/api';
import { Modal } from '../ui/Modal';

const ScheduleQueue: React.FC = () => {
  const [items, setItems] = useState<ScheduleQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ScheduleQueueItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getScheduleQueue();
      setItems(res.queue || []);
    } catch (e: any) {
      console.error('Failed to load queue', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try {
      await approveQueueItem(id);
      await load();
      setSelected(null);
    } catch (e: any) {
      console.error('Approve failed', e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(true);
    try {
      await rejectQueueItem(id);
      await load();
      setSelected(null);
    } catch (e: any) {
      console.error('Reject failed', e);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="settings-page">
      <Card>
        <CardHeader>
          <CardTitle>待审批的新增日程请求</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div>加载中...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.length === 0 && <div>当前没有等待审批的日程请求。</div>}
              {items.map(item => {
                let payload: any = null;
                try { payload = JSON.parse(item.rawRequest); } catch { payload = null; }
                const args = payload?.args || payload || {};
                return (
                  <div key={item.id} style={{ border: '1px solid var(--muted)', padding: 12, borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{args.name || '未命名请求'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(item.createdAt).toLocaleString()}</div>
                      <div style={{ marginTop: 6 }}>{args.startTime ? `${args.startTime} → ${args.endTime || ''}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="ghost" onClick={() => setSelected(item)}>查看</Button>
                      <Button onClick={() => handleApprove(item.id)} disabled={actionLoading}>允许并添加</Button>
                      <Button variant="danger" onClick={() => handleReject(item.id)} disabled={actionLoading}>拒绝</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="请求详情">
        {selected ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {selected.rawRequest}
          </div>
        ) : null}
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={() => setSelected(null)}>关闭</Button>
          {selected && <Button onClick={() => handleApprove(selected.id)} disabled={actionLoading}>允许并添加</Button>}
        </div>
      </Modal>
    </div>
  );
};

export default ScheduleQueue;
