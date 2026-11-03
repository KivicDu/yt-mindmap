import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMindmapConfig } from '../../context/MindmapConfig'
import type { MindmapLayout, MindmapPalette } from '../../context/MindmapConfig'
import './Setup.css'

const layouts: { id: MindmapLayout; title: string; desc: string }[] = [
  { id: 'tree', title: 'Classic Tree', desc: 'Cấu trúc phân cấp rõ ràng, dễ theo dõi.' },
  { id: 'radial', title: 'Radial Mindmap', desc: 'Tập trung vào chủ đề chính, phù hợp ôn tập.' },
]

const palettes: { id: MindmapPalette; title: string; colors: string[] }[] = [
  { id: 'pastel', title: 'Pastel', colors: ['#f0f3ff', '#e8f7ff', '#f5f3ff', '#f8f9fb'] },
  { id: 'mono', title: 'Mono', colors: ['#f8f9fb', '#f6f7fa', '#ececf3', '#3f3f46'] },
  { id: 'ocean', title: 'Ocean', colors: ['#f0f9ff', '#e0f2fe', '#bae6fd', '#0369a1'] },
  { id: 'violet', title: 'Violet', colors: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#6d28d9'] },
]

function Setup() {
  const navigate = useNavigate()
  const { setConfig } = useMindmapConfig()
  const [layout, setLayout] = useState<MindmapLayout>('tree')
  const [palette, setPalette] = useState<MindmapPalette>('pastel')

  const handleContinue = () => {
    setConfig({ layout, palette })
    navigate('/app')
  }

  const handleSkip = () => {
    setConfig({ layout: 'tree', palette: 'pastel' })
    navigate('/app')
  }

  return (
    <main className="setup">
      <div className="setup-container">
        <header className="setup-header">
          <button className="setup-back" onClick={() => navigate('/')}>← Quay lại</button>
          <div className="setup-brand">yt-mindmap</div>
        </header>
        <section className="setup-hero">
          <h1>Tùy chỉnh sơ đồ tư duy</h1>
          <p>Chọn kiểu hiển thị và bảng màu phù hợp với phong cách học tập của bạn.</p>
        </section>
        <section className="setup-section">
          <h2>Kiểu sơ đồ</h2>
          <div className="card-grid">
            {layouts.map((item) => (
              <button
                key={item.id}
                className={`select-card ${layout === item.id ? 'select-card-active' : ''}`}
                onClick={() => setLayout(item.id)}
              >
                <div className="select-card-title">{item.title}</div>
                <div className="select-card-desc">{item.desc}</div>
              </button>
            ))}
          </div>
        </section>
        <section className="setup-section">
          <h2>Bảng màu</h2>
          <div className="swatch-grid">
            {palettes.map((item) => (
              <button
                key={item.id}
                className={`swatch-card ${palette === item.id ? 'swatch-card-active' : ''}`}
                onClick={() => setPalette(item.id)}
              >
                <div className="swatch-row">
                  {item.colors.map((color, idx) => (
                    <span key={idx} className="swatch-dot" style={{ background: color }} />
                  ))}
                </div>
                <div className="swatch-title">{item.title}</div>
              </button>
            ))}
          </div>
        </section>
        <footer className="setup-footer">
          <button className="btn-ghost" onClick={handleSkip}>Bỏ qua & dùng mặc định</button>
          <button className="btn-primary" onClick={handleContinue}>Tiếp tục</button>
        </footer>
      </div>
    </main>
  )
}

export default Setup
