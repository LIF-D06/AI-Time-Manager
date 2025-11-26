import React from 'react';
import { Modal } from '../ui/Modal';

export interface BaseScheduleProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

export default abstract class BaseScheduleView<P extends BaseScheduleProps, S> extends React.Component<P, S> {
  protected formatLocalDateTime(iso?: string) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }

  protected renderModal(title: string | undefined, content: React.ReactNode, footer?: React.ReactNode) {
    return (
      <Modal isOpen={this.props.isOpen} onClose={this.props.onClose} title={title} footer={footer}>
        {content}
      </Modal>
    );
  }

  // 子类必须实现自己的渲染逻辑
  public abstract render(): React.ReactNode;
}
