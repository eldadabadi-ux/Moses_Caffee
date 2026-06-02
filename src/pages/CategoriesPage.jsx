import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Tag, X, Check } from 'lucide-react'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import ConfirmDialog from '../components/ui/ConfirmDialog'

export default function CategoriesPage() {
  const { user } = useAuth()
  const [categories, setCategories] = useState([])
  const [loading, setLoading]       = useState(true)
  const [deleteId, setDeleteId]     = useState(null)
  const [expanded, setExpanded]     = useState({})
  const [editId, setEditId]         = useState(null)
  const [editName, setEditName]     = useState('')
  const [addingTo, setAddingTo]     = useState(null)
  const [newName, setNewName]       = useState('')
  const [saving, setSaving]         = useState(false)

  useEffect(() => { if (user) load() }, [user])  // eslint-disable-line

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('level').order('sort_order')
      if (error) throw error
      const cats = data || []
      setCategories(cats)
      const initExpanded = {}
      cats.filter(c => c.level === 1).forEach(c => { initExpanded[c.id] = true })
      setExpanded(initExpanded)
    } catch (err) {
      toast.error('שגיאה בטעינה: ' + err.message)
      setCategories([])
    } finally {
      setLoading(false)
    }
  }

  async function addCategory(parentId, level) {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase.from('categories').insert({
        user_id:    user.id,
        name:       newName.trim(),
        parent_id:  parentId || null,
        level:      level || 1,
        sort_order: categories.filter(c => c.parent_id === parentId && c.level === level).length,
      })
      if (error) throw error
      toast.success('קטגוריה נוספה')
      setNewName(''); setAddingTo(null)
      load()
    } catch (err) {
      toast.error('שגיאה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function updateCategory(id) {
    if (!editName.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase.from('categories').update({ name: editName.trim() }).eq('id', id)
      if (error) throw error
      toast.success('קטגוריה עודכנה'); setEditId(null); setEditName(''); load()
    } catch (err) { toast.error('שגיאה: ' + err.message) } finally { setSaving(false) }
  }

  async function deleteCategory() {
    try {
      const { error } = await supabase.from('categories').delete().eq('id', deleteId)
      if (error) throw error
      toast.success('קטגוריה נמחקה'); setDeleteId(null); load()
    } catch (err) { toast.error('שגיאה: ' + err.message) }
  }

  const l1 = categories.filter(c => c.level === 1)
  const l2 = categories.filter(c => c.level === 2)
  const l3 = categories.filter(c => c.level === 3)

  const FS_INLINE = {
    border: '1px solid var(--accent)', borderRadius: '6px', padding: '5px 10px',
    fontSize: '13px', color: 'var(--text)', background: 'var(--panel)',
    outline: 'none', fontFamily: 'var(--font-main)', minWidth: '180px',
  }

  function CategoryRow({ cat, depth = 0 }) {
    const children = depth === 0 ? l2.filter(c => c.parent_id === cat.id)
                   : depth === 1 ? l3.filter(c => c.parent_id === cat.id)
                   : []
    const hasChildren  = children.length > 0
    const isExpanded   = expanded[cat.id] !== false
    const isEditing    = editId === cat.id
    const isAddingChild = addingTo?.parentId === cat.id

    return (
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: `9px 16px 9px ${16 + depth * 24}px`,
          borderBottom: '1px solid var(--border)',
          background: depth === 0 ? 'var(--panel)' : depth === 1 ? 'var(--panel-2)' : 'rgba(0,0,0,0.02)',
        }}>
          {hasChildren || depth < 2 ? (
            <button onClick={() => hasChildren ? setExpanded(p => ({ ...p, [cat.id]: !p[cat.id] })) : null}
              style={{ background:'none', border:'none', cursor: hasChildren ? 'pointer' : 'default', color:'var(--text-mute)', padding:'2px', display:'flex', alignItems:'center', flexShrink:0 }}>
              {hasChildren ? isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span style={{ width:17, display:'inline-block' }} />}
            </button>
          ) : <span style={{ width:21, display:'inline-block' }} />}

          <Tag size={12} style={{ color: depth === 0 ? 'var(--accent)' : depth === 1 ? '#7c3aed' : '#059669', flexShrink:0 }} />

          {isEditing ? (
            <>
              <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') updateCategory(cat.id); if (e.key === 'Escape') { setEditId(null); setEditName('') } }}
                style={{ ...FS_INLINE, flex:1, maxWidth:'260px' }} dir="auto" />
              <button onClick={() => updateCategory(cat.id)} disabled={saving} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ok)', display:'flex', padding:'2px' }}><Check size={15} /></button>
              <button onClick={() => { setEditId(null); setEditName('') }} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', display:'flex', padding:'2px' }}><X size={14} /></button>
            </>
          ) : (
            <>
              <span style={{ flex:1, fontSize: depth === 0 ? '14px' : '13px', fontWeight: depth === 0 ? 600 : 500, color:'var(--text)' }}>{cat.name}</span>
              {children.length > 0 && <span style={{ fontSize:'11px', color:'var(--text-mute)', background:'var(--panel-2)', border:'1px solid var(--border)', borderRadius:'999px', padding:'1px 8px' }}>{children.length} תתי-קטגוריות</span>}
            </>
          )}

          {!isEditing && (
            <div style={{ display:'flex', gap:'2px', flexShrink:0, opacity:0.7 }}>
              {depth < 2 && (
                <button onClick={() => { setAddingTo({ parentId: cat.id, level: depth + 2 }); setExpanded(p => ({ ...p, [cat.id]: true })) }}
                  title="הוסף תת-קטגוריה"
                  style={{ padding:'4px 6px', background:'none', border:'none', cursor:'pointer', color:'var(--accent)', borderRadius:'6px', fontSize:'11px', display:'flex', alignItems:'center', gap:'3px' }}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--panel-2)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                  <Plus size={12} />
                </button>
              )}
              <button onClick={() => { setEditId(cat.id); setEditName(cat.name) }} title="עריכה"
                style={{ padding:'4px 6px', background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', borderRadius:'6px', display:'flex', alignItems:'center' }}
                onMouseEnter={e=>e.currentTarget.style.background='var(--panel-2)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                <Pencil size={12} />
              </button>
              <button onClick={() => setDeleteId(cat.id)} title="מחיקה"
                style={{ padding:'4px 6px', background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', borderRadius:'6px', display:'flex', alignItems:'center' }}
                onMouseEnter={e=>{e.currentTarget.style.background='#fef2f2';e.currentTarget.style.color='var(--danger)'}} onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color='var(--text-mute)'}}>
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>

        {isAddingChild && isExpanded && (
          <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:`8px 16px 8px ${16 + (depth + 1) * 24 + 21}px`, background: depth === 0 ? 'var(--panel-2)' : 'rgba(0,0,0,0.02)', borderBottom:'1px solid var(--border)' }}>
            <Tag size={12} style={{ color: depth === 0 ? '#7c3aed' : '#059669', flexShrink:0 }} />
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCategory(addingTo.parentId, addingTo.level); if (e.key === 'Escape') { setAddingTo(null); setNewName('') } }}
              placeholder={`שם תת-קטגוריה חדשה (L${depth + 2})`} dir="auto" style={{ ...FS_INLINE, flex:1 }} />
            <button onClick={() => addCategory(addingTo.parentId, addingTo.level)} disabled={saving || !newName.trim()}
              style={{ padding:'6px 12px', background:'var(--accent)', color:'white', border:'none', borderRadius:'6px', fontSize:'12.5px', fontWeight:600, cursor:'pointer', fontFamily:'var(--font-main)' }}>הוסף</button>
            <button onClick={() => { setAddingTo(null); setNewName('') }} style={{ padding:'6px', background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', display:'flex' }}><X size={14} /></button>
          </div>
        )}

        {isExpanded && children.map(child => <CategoryRow key={child.id} cat={child} depth={depth + 1} />)}
      </div>
    )
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="animate-fade-in" style={{ display:'flex', flexDirection:'column', gap:'24px', maxWidth:'800px' }} dir="rtl">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
        <div>
          <h1 style={{ fontSize:'20px', fontWeight:700, color:'var(--text)', margin:0 }}>קטגוריות הוצאות</h1>
          <p style={{ fontSize:'13px', color:'var(--text-mute)', marginTop:'4px' }}>ניהול עץ הקטגוריות ההיררכי — עד 3 רמות</p>
        </div>
        <button onClick={() => { setAddingTo({ parentId: null, level: 1 }); setNewName('') }}
          style={{ display:'flex', alignItems:'center', gap:'8px', padding:'9px 18px', background:'var(--accent)', color:'white', border:'none', borderRadius:'var(--r-btn)', fontSize:'13.5px', fontWeight:600, cursor:'pointer', fontFamily:'var(--font-main)' }}>
          <Plus size={15} /> קטגוריה ראשית
        </button>
      </div>

      <div style={{ display:'flex', gap:'16px', flexWrap:'wrap' }}>
        {[
          { label: 'קטגוריות ראשיות (L1)', val: l1.length, color: 'var(--accent)' },
          { label: 'תתי-קטגוריות (L2)',    val: l2.length, color: '#7c3aed' },
          { label: 'תתי-תתי (L3)',         val: l3.length, color: '#059669' },
        ].map(s => (
          <div key={s.label} style={{ background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'var(--r-card)', padding:'12px 20px', display:'flex', alignItems:'center', gap:'12px' }}>
            <span style={{ fontSize:'24px', fontWeight:700, color: s.color }}>{s.val}</span>
            <span style={{ fontSize:'12.5px', color:'var(--text-mute)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {addingTo?.level === 1 && (
        <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'14px 16px', background:'var(--panel)', border:'2px solid var(--accent)', borderRadius:'var(--r-card)' }}>
          <Tag size={14} style={{ color:'var(--accent)', flexShrink:0 }} />
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCategory(null, 1); if (e.key === 'Escape') { setAddingTo(null); setNewName('') } }}
            placeholder="שם קטגוריה ראשית חדשה (L1)" dir="auto" style={{ ...FS_INLINE, flex:1 }} />
          <button onClick={() => addCategory(null, 1)} disabled={saving || !newName.trim()}
            style={{ padding:'8px 16px', background:'var(--accent)', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:600, cursor:'pointer', fontFamily:'var(--font-main)' }}>הוסף</button>
          <button onClick={() => { setAddingTo(null); setNewName('') }} style={{ padding:'6px', background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', display:'flex' }}><X size={16} /></button>
        </div>
      )}

      <div style={{ background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'var(--r-hero)', boxShadow:'var(--shadow-card)', overflow:'hidden' }}>
        {l1.length === 0 ? (
          <div style={{ padding:'48px 24px', textAlign:'center' }}>
            <Tag size={32} style={{ color:'var(--text-mute)', margin:'0 auto 12px', display:'block' }} />
            <p style={{ fontWeight:600, color:'var(--text)', fontSize:'14px' }}>אין קטגוריות עדיין</p>
            <p style={{ color:'var(--text-mute)', fontSize:'13px', marginTop:'4px' }}>קטגוריות נוצרות אוטומטית בסריקת קבלות AI, או ניתן להוסיפן ידנית.</p>
          </div>
        ) : (
          <>
            <div style={{ display:'flex', alignItems:'center', padding:'10px 16px', background:'var(--panel-2)', borderBottom:'1px solid var(--border)' }}>
              <span style={{ flex:1, fontSize:'11.5px', fontWeight:600, color:'var(--text-mute)', textTransform:'uppercase', letterSpacing:'0.07em' }}>שם קטגוריה</span>
              <span style={{ fontSize:'11.5px', fontWeight:600, color:'var(--text-mute)', textTransform:'uppercase', letterSpacing:'0.07em' }}>פעולות</span>
            </div>
            {l1.map(cat => <CategoryRow key={cat.id} cat={cat} depth={0} />)}
          </>
        )}
      </div>

      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={deleteCategory}
        title="מחיקת קטגוריה" message="האם למחוק את הקטגוריה? תתי-קטגוריות יאבדו את הקישור." />
    </div>
  )
}
