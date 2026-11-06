import { useId, useState } from 'react';

type ImageUploadProps = {
  label: string;
  value?: string | null;
  onChange: (value: string | null) => void;
};

export function ImageUpload({ label, value, onChange }: ImageUploadProps) {
  const inputId = useId();
  const [error, setError] = useState('');
  return (
    <div className="space-y-3">
      <label htmlFor={inputId} className="block text-[10px] voice text-muted">{label}</label>
      {value && <img src={value} alt={`${label} preview`} className="h-24 w-24 object-cover" />}
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="block w-full text-sm text-muted file:mr-4 file:border-0 file:bg-cream file:px-4 file:py-2 file:text-bg"
        onChange={(event) => {
          const file = event.target.files?.[0];
          setError('');
          if (!file) return;
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 650_000) {
            setError('Choose a PNG, JPEG or WebP smaller than 650 KB.');
            event.target.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = () => { if (typeof reader.result === 'string') onChange(reader.result); };
          reader.onerror = () => setError('This image could not be read.');
          reader.readAsDataURL(file);
        }}
      />
      {value && <button type="button" onClick={() => onChange(null)} className="text-xs text-muted hover:text-ink">remove image</button>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
