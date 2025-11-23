# UI Component Library Documentation

This document provides an overview and usage guide for the reusable UI components available in the `src/components/ui` directory.

## Table of Contents

- [Badge](#badge)
- [Button](#button)
- [Card](#card)
- [CurrentTimeDisplay](#currenttimedisplay)
- [Input](#input)
- [Modal](#modal)
- [Textarea](#textarea)
- [ToggleButton](#togglebutton)

---

## Badge

A small status indicator for labels, counts, or states.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'success' \| 'warning' \| 'error' \| 'info' \| 'neutral'` | `'neutral'` | The visual style of the badge. |
| `className` | `string` | `''` | Additional CSS classes. |
| `children` | `React.ReactNode` | - | The content to display inside the badge. |
| `...props` | `React.HTMLAttributes<HTMLSpanElement>` | - | Standard HTML span attributes. |

### Usage

```tsx
import { Badge } from '../components/ui/Badge';

<Badge variant="success">Completed</Badge>
<Badge variant="error">Failed</Badge>
```

---

## Button

A versatile button component supporting multiple variants and sizes.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'primary' \| 'secondary' \| 'outline' \| 'ghost' \| 'danger'` | `'primary'` | The visual style of the button. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | The size of the button. |
| `className` | `string` | `''` | Additional CSS classes. |
| `children` | `React.ReactNode` | - | The content of the button. |
| `...props` | `React.ButtonHTMLAttributes<HTMLButtonElement>` | - | Standard HTML button attributes (onClick, disabled, etc.). |

### Usage

```tsx
import { Button } from '../components/ui/Button';

<Button onClick={handleClick}>Click Me</Button>
<Button variant="outline" size="sm">Small Outline</Button>
<Button variant="danger" disabled>Delete</Button>
```

---

## Card

A container component for grouping related content. Includes sub-components for header, title, content, and footer.

### Components

- `Card`: The main container.
- `CardHeader`: Container for the card's header.
- `CardTitle`: The title of the card.
- `CardContent`: The main content area.
- `CardFooter`: Container for the card's footer actions.

### Props (Common)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `className` | `string` | `''` | Additional CSS classes. |
| `children` | `React.ReactNode` | - | The content. |
| `...props` | `React.HTMLAttributes<HTMLDivElement>` | - | Standard HTML div attributes. |

### Usage

```tsx
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
  </CardHeader>
  <CardContent>
    <p>This is the main content of the card.</p>
  </CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>
```

---

## CurrentTimeDisplay

A simple component that displays the current time in `HH:mm` format and updates every minute.

### Props

None.

### Usage

```tsx
import CurrentTimeDisplay from '../components/ui/CurrentTimeDisplay';

<CurrentTimeDisplay />
```

---

## Input

A styled input field with support for labels and error messages.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | `undefined` | The label text displayed above the input. |
| `error` | `string` | `undefined` | Error message displayed below the input. |
| `className` | `string` | `''` | Additional CSS classes. |
| `id` | `string` | `undefined` | ID for the input. If not provided, a random ID is generated. |
| `...props` | `React.InputHTMLAttributes<HTMLInputElement>` | - | Standard HTML input attributes. |

### Usage

```tsx
import { Input } from '../components/ui/Input';

<Input 
  label="Username" 
  placeholder="Enter your username" 
  onChange={handleChange} 
/>

<Input 
  label="Email" 
  type="email" 
  error="Invalid email address" 
/>
```

---

## Modal

A dialog component that overlays the main content.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | - | Whether the modal is visible. |
| `onClose` | `() => void` | - | Callback function when the modal should close. |
| `title` | `string` | `undefined` | The title displayed in the modal header. |
| `children` | `React.ReactNode` | - | The content of the modal body. |
| `footer` | `React.ReactNode` | `undefined` | Content for the modal footer (e.g., action buttons). |
| `closeOnOverlayClick` | `boolean` | `true` | Whether clicking the overlay closes the modal. |

### Usage

```tsx
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';

<Modal
  isOpen={isModalOpen}
  onClose={() => setIsModalOpen(false)}
  title="Confirm Action"
  footer={
    <>
      <Button variant="secondary" onClick={close}>Cancel</Button>
      <Button onClick={confirm}>Confirm</Button>
    </>
  }
>
  <p>Are you sure you want to proceed?</p>
</Modal>
```

---

## Textarea

A styled textarea field with support for labels and error messages.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | `undefined` | The label text displayed above the textarea. |
| `error` | `string` | `undefined` | Error message displayed below the textarea. |
| `className` | `string` | `''` | Additional CSS classes. |
| `id` | `string` | `undefined` | ID for the textarea. If not provided, a random ID is generated. |
| `...props` | `React.TextareaHTMLAttributes<HTMLTextAreaElement>` | - | Standard HTML textarea attributes. |

### Usage

```tsx
import { Textarea } from '../components/ui/Textarea';

<Textarea 
  label="Description" 
  placeholder="Enter description..." 
  rows={4}
/>
```

---

## ToggleButton

A button that toggles between two states, useful for switching modes or statuses.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isToggled` | `boolean` | - | The current state of the toggle. |
| `onToggle` | `() => void` | - | Callback function when the button is clicked. |
| `toggledIcon` | `React.ReactNode` | `undefined` | Icon to display when toggled on. |
| `untoggledIcon` | `React.ReactNode` | `undefined` | Icon to display when toggled off. |
| `toggledText` | `string` | `undefined` | Text to display when toggled on. |
| `untoggledText` | `string` | `undefined` | Text to display when toggled off. |
| `toggledClassName` | `string` | `'toggled'` | CSS class applied when toggled on. |
| `className` | `string` | `''` | Additional CSS classes. |
| `disabled` | `boolean` | `false` | Whether the button is disabled. |
| `variant` | `'primary' \| 'secondary' \| 'outline' \| 'ghost' \| 'danger'` | `'ghost'` | The button variant style. |

### Usage

```tsx
import { ToggleButton } from '../components/ui/ToggleButton';
import { Check, X } from 'lucide-react';

<ToggleButton
  isToggled={isCompleted}
  onToggle={() => setIsCompleted(!isCompleted)}
  toggledIcon={<Check />}
  untoggledIcon={<X />}
  toggledText="Completed"
  untoggledText="Incomplete"
/>
```
