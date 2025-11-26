import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import ScheduleCard from './ScheduleCard';
import { getScheduleQueue, approveQueueItem, rejectQueueItem } from '../../services/api';
import type { ScheduleQueueItem } from '../../services/api';
import QueueTaskModal from './QueueTaskModal';

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
                // 安全解析 rawRequest（可能是 stringified JSON 或已对象）并提取常用字段
                let parsed: any = null;
                try {
                  parsed = typeof item.rawRequest === 'string' ? JSON.parse(item.rawRequest) : item.rawRequest;
                } catch (e) {
                  parsed = null;
                }
                const args = parsed?.args || parsed || {};
                const name = args.name || args.title || '未命名请求';
                const description = args.description || args.body || '';
                // 期望 ISO 字符串（含时区/偏移），传给 ScheduleCard 以便按浏览器本地时区显示
                const startTime = args.startTime || args.start || '';
                const endTime = args.endTime || args.end || '';
                const location = args.location || args.place || '';

                return (
                  <ScheduleCard
                    key={item.id}
                    name={name}
                    description={description}
                    startTime={startTime}
                    endTime={endTime}
                    location={location}
                    onClick={() => setSelected(item)}
                    rightActions={(
                      <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" onClick={() => setSelected(item)}>查看</Button>
                        <Button onClick={() => handleApprove(item.id)} disabled={actionLoading}>允许并添加</Button>
                        <Button variant="danger" onClick={() => handleReject(item.id)} disabled={actionLoading}>拒绝</Button>
                      </div>
                    )}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <QueueTaskModal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        item={selected}
        onAdded={() => load()}
      />
    </div>
  );
};

export default ScheduleQueue;
