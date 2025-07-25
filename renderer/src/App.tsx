import React, { useState } from 'react';

declare global {
  interface Window {
    api: {
      transcribe: (lang: string) => Promise<string>;
    };
  }
}

const languages = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'es', label: 'Español' },
];

const App: React.FC = () => {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [lang, setLang] = useState('en');

  const handleClick = async () => {
    setLoading(true);
    try {
      const result = await window.api.transcribe(lang);
      setText(result);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-xl mb-4">Whisper Transcription</h1>

      <label className="block mb-2">
        Язык:
        <select
          value={lang}
          onChange={e => setLang(e.target.value)}
          className="ml-2 p-1 border rounded"
        >
          {languages.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={handleClick}
        disabled={loading}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        {loading ? 'Transcribing...' : 'Choose Audio & Transcribe'}
      </button>

      <pre className="mt-4 whitespace-pre-wrap">{text}</pre>
    </div>
  );
};

export default App;
