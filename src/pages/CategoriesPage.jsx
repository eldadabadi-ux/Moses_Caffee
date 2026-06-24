import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useTenant } from '../hooks/useTenant'
import { getCached, setCached, hasCached } from '../lib/pageCache'
import { recategorizeAll } from '../lib/recategorize'
import { classifyReceipt } from '../../functions/api/_lib/classifyReceipt'
import { normalizeCategoryName, categoryKey } from '../lib/categoryNormalize'
import { flattenItems } from '../lib/itemAggregation'
import { nodePath } from '../lib/categoryStats'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Tag, X, Check, RefreshCw, PieChart } from 'lucide-react'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Modal from '../components/ui/Modal'
import CategoryInsightPanel from '../components/CategoryInsightPanel'

export default function CategoriesPage() {
  const { user } = useAuth()
  const { orgId } = useTenant()
  const [categories, setCategories] = useState(() => getCached('categories')?.categories || [])
  const [loading, setLoading]       = useState(() => !hasCached('categories'))
  const [deleteId, setDeleteId]     = useState(null)
  const [expanded, setExpanded]     = useState({})   // tree starts COLLAPSED on every open
  const [editId, setEditId]         = useState(null)
  const [editName, setEditName]     = useState('')
  const [addingTo, setAddingTo]     = useState(null)
  const [newName, setNewName]       = useState('')
  const [saving, setSaving]         = useState(false)
  const [recatBusy, setRecatBusy]   = useState(false)
  const recatTimer = useRef(null)
  const navigate = useNavigate()

  // ── Analytics (insight panel) ────────────────────────────────────────────────
  const [selectedNode, setSelectedNode] = useState(null)
  const [panelOpen, setPanelOpen]       = useState(false)   // mobile: insight modal visibility
  const [anaReceipts, setAnaReceipts]   = useState(() => getCached('cat-analytics') || [])
  const [isMobile, setIsMobile]         = useState(() => window.innerWidth < 768)
  const flatItems = useMemo(() => flattenItems(anaReceipts), [anaReceipts])

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  // Receipts for the per-category analytics — ALL receipts incl. archived, to
  // match the dashboard (archived still count in stats).
  async function loadAnalytics() {
    try {
      const { data } = await supabase.from('receipts')
        .select('id, vendor_name, amount, receipt_date, category_text, category_id, items, archived_at')
        .eq('user_id', user.id)
      if (data) { setAnaReceipts(data); setCached('cat-analytics', data) }
    } catch (e) { console.warn('[categories] analytics load:', e?.message) }
  }

  const jumpVendor   = (name) => navigate('/suppliers?focus=' + encodeURIComponent(name))
  const jumpReceipts = (name) => navigate('/receipts?q=' + encodeURIComponent(name))

  useEffect(() => { if (user) load() }, [user])  // eslint-disable-line
  useEffect(() => { if (user) loadAnalytics() }, [user])  // eslint-disable-line
  useEffect(() => () => clearTimeout(recatTimer.current), [])

  // Sidebar-triggered actions
  useEffect(() => {
    const onAdd = () => { setAddingTo({ parentId: null, level: 1 }); setNewName('') }
    const onRecat = () => runRecategorize(false)
    window.addEventListener('categories-add', onAdd)
    window.addEventListener('categories-recat', onRecat)
    return () => {
      window.removeEventListener('categories-add', onAdd)
      window.removeEventListener('categories-recat', onRecat)
    }
  }, [])  // eslint-disable-line

  // Run the AI re-classification of existing receipts against the updated tree.
  async function runRecategorize(silent = false) {
    if (recatBusy) return
    setRecatBusy(true)
    const tid = toast.loading('מסווג מחדש את הקבלות לפי הקטגוריות…')
    try {
      const { changed, total } = await recategorizeAll()
      toast.dismiss(tid)
      if (total === 0) { if (!silent) toast('אין קבלות לסיווג', { icon: 'ℹ️' }) }
      else toast.success(`עודכנו ${changed} מתוך ${total} קבלות`)
      load()   // refresh the tree — categories created during the sync now appear
    } catch (err) {
      toast.dismiss(tid)
      toast.error('שגיאה בסיווג מחדש: ' + (err?.message || ''))
    } finally {
      setRecatBusy(false)
    }
  }

  // Debounced trigger — after the user adds/edits categories, wait for them to
  // finish, then re-classify existing receipts automatically.
  function scheduleRecategorize() {
    clearTimeout(recatTimer.current)
    recatTimer.current = setTimeout(() => runRecategorize(true), 4000)
  }

  // Full sync + cleanup — keeps the category tree perfect: correct Hebrew
  // spelling, NO duplicates, and a category + sub-category for every receipt.
  //  Pass 0 normalises spelling and MERGES duplicates (a garbled "מוצון ומכולת"
  //  is merged into "מוצרי מזון ומכולת" and its receipts reassigned).
  //  Pass 1/2 then create whatever category / sub-category is still missing.
  async function syncMissingCategories() {
    try {
      const [{ data: recs }, { data: cats }] = await Promise.all([
        supabase.from('receipts').select('vendor_name, category_text, items').is('archived_at', null),
        supabase.from('categories').select('id, name, parent_id, level'),
      ])
      const all = (cats || []).slice()
      let changed = false

      // ── Pass 0 — normalise spelling + merge duplicates (top-down L1->L3) ──
      const childrenOf = (pid, level) => all.filter(c => !c._gone && (c.parent_id || null) === (pid || null) && c.level === level)
      async function mergeInto(dup, survivor) {
        const childLevel = survivor.level + 1
        if (childLevel <= 3) {
          const survKids = childrenOf(survivor.id, childLevel)
          for (const dk of childrenOf(dup.id, childLevel)) {
            const match = survKids.find(sk => categoryKey(sk.name) === categoryKey(dk.name))
            if (match) { await mergeInto(dk, match) }
            else {
              await supabase.from('categories').update({ parent_id: survivor.id }).eq('id', dk.id)
              dk.parent_id = survivor.id; survKids.push(dk)
            }
          }
        }
        // Receipts referencing the dup L1 -> survivor (by id and by stored name).
        await supabase.from('receipts').update({ category_id: survivor.id, category_text: survivor.name }).eq('category_id', dup.id)
        await supabase.from('receipts').update({ category_id: survivor.id, category_text: survivor.name }).eq('category_text', dup.name)
        await supabase.from('categories').delete().eq('id', dup.id)
        dup._gone = true; changed = true
      }
      for (const level of [1, 2, 3]) {
        const parentIds = level === 1 ? [null]
          : [...new Set(all.filter(c => !c._gone && c.level === level - 1).map(c => c.id))]
        for (const pid of parentIds) {
          const sibs = all.filter(c => !c._gone && c.level === level && (c.parent_id || null) === (pid || null))
          const groups = new Map()
          for (const c of sibs) {
            const k = categoryKey(c.name)
            if (!groups.has(k)) groups.set(k, [])
            groups.get(k).push(c)
          }
          for (const rows of groups.values()) {
            const canon = normalizeCategoryName(rows[0].name)
            let survivor = rows.find(r => (r.name || '').trim() === canon) || rows[0]
            if ((survivor.name || '').trim() !== canon) {   // fix the spelling on the survivor
              await supabase.from('categories').update({ name: canon }).eq('id', survivor.id)
              if (level === 1) await supabase.from('receipts').update({ category_text: canon }).eq('category_text', survivor.name)
              survivor.name = canon; changed = true
            }
            for (const r of rows) if (r.id !== survivor.id) await mergeInto(r, survivor)
          }
        }
      }

      // ── Pass 1/2 — create the category + sub-category each receipt needs ──
      const live = () => all.filter(c => !c._gone)
      const l1ByKey = new Map(), l2ByKey = new Map()
      const reindex = () => {
        l1ByKey.clear(); l2ByKey.clear()
        live().forEach(c => {
          if (c.level === 1) l1ByKey.set(categoryKey(c.name), c)
          else if (c.level === 2) l2ByKey.set((c.parent_id) + '|' + categoryKey(c.name), c)
        })
      }
      reindex()

      const needL1 = new Map()   // key -> canonical name
      const needL2 = []          // { l1key, l2name }
      const addL1 = n => { const name = normalizeCategoryName(n); if (name) needL1.set(categoryKey(name), name) }
      const addL2 = (a, b) => {
        const l1 = normalizeCategoryName(a), l2 = normalizeCategoryName(b)
        if (l1 && l2) { needL1.set(categoryKey(l1), l1); needL2.push({ l1key: categoryKey(l1), l2name: l2 }) }
      }
      for (const r of (recs || [])) {
        addL1(r.category_text)
        const hit = classifyReceipt(r)
        if (hit) addL2(hit.l1, hit.l2)
        for (const it of (Array.isArray(r.items) ? r.items : [])) {
          addL1(it?.category_l1)
          addL2(it?.category_l1, it?.category_l2)
        }
      }

      const so = {}
      const nextSO = (level, parent) => {
        const k = level + '|' + (parent || 'root')
        if (!(k in so)) so[k] = live().filter(c => c.level === level && (c.parent_id || null) === (parent || null)).length
        return so[k]++
      }

      // Phase 1 — missing L1
      const missL1 = [...needL1.entries()].filter(([k]) => !l1ByKey.has(k))
      if (missL1.length) {
        const rows = missL1.map(([, name]) => ({ user_id: user.id, org_id: orgId || null, name, level: 1, parent_id: null, sort_order: nextSO(1, null) }))
        const { data: ins } = await supabase.from('categories').insert(rows).select('id, name, parent_id, level')
        ;(ins || []).forEach(c => all.push(c)); if (ins?.length) changed = true; reindex()
      }
      // Phase 2 — missing L2
      const seenL2 = new Set(), missL2 = []
      for (const { l1key, l2name } of needL2) {
        const p = l1ByKey.get(l1key); if (!p) continue
        const key = p.id + '|' + categoryKey(l2name)
        if (l2ByKey.has(key) || seenL2.has(key)) continue
        seenL2.add(key); missL2.push({ parent_id: p.id, name: l2name })
      }
      if (missL2.length) {
        const rows = missL2.map(m => ({ user_id: user.id, org_id: orgId || null, name: m.name, level: 2, parent_id: m.parent_id, sort_order: nextSO(2, m.parent_id) }))
        const { data: ins } = await supabase.from('categories').insert(rows).select('id')
        if (ins?.length) changed = true
      }
      return changed
    } catch (e) { console.warn('[categories] sync:', e?.message); return false }
  }

  async function load() {
    if (!hasCached('categories')) setLoading(true)
    try {
      await syncMissingCategories()   // create any categories used by receipts but missing here
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('level').order('sort_order')
      if (error) throw error
      const cats = data || []
      setCategories(cats)
      // Tree stays COLLAPSED by default — we don't auto-expand any level. (We
      // also don't override `expanded` here, so toggles made during the session
      // are preserved across background refreshes.)
      setCached('categories', { categories: cats, expanded: {} })
    } catch (err) {
      toast.error('שגיאה בטעינה: ' + err.message)
      setCategories([])
    } finally {
      setLoading(false)
    }
  }

  async function addCategory(parentId, level) {
    const name = normalizeCategoryName(newName)   // correct spelling / canonical form
    if (!name) return
    // Block duplicates: a sibling with the same canonical name already exists.
    const dup = categories.find(c => c.level === (level || 1) && (c.parent_id || null) === (parentId || null) && categoryKey(c.name) === categoryKey(name))
    if (dup) {
      toast(`הקטגוריה "${dup.name}" כבר קיימת`, { icon: 'ℹ️' })
      setNewName(''); setAddingTo(null)
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('categories').insert({
        user_id:    user.id,
        org_id:     orgId || null,
        name,
        parent_id:  parentId || null,
        level:      level || 1,
        sort_order: categories.filter(c => c.parent_id === parentId && c.level === level).length,
      })
      if (error) throw error
      toast.success('קטגוריה נוספה')
      setNewName(''); setAddingTo(null)
      load()
      scheduleRecategorize()   // re-sort existing receipts into the new category
    } catch (err) {
      toast.error('שגיאה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function updateCategory(id) {
    const name = normalizeCategoryName(editName)
    if (!name) return
    setSaving(true)
    try {
      const { error } = await supabase.from('categories').update({ name }).eq('id', id)
      if (error) throw error
      toast.success('קטגוריה עודכנה'); setEditId(null); setEditName(''); load()
      scheduleRecategorize()
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
    const isExpanded   = expanded[cat.id] === true   // collapsed unless explicitly opened
    const isEditing    = editId === cat.id
    const isAddingChild = addingTo?.parentId === cat.id
    const isSelected   = selectedNode?.id === cat.id
    // Open the analysis for this node — modal on mobile, side panel on desktop.
    const openInsights = () => { setSelectedNode(cat); if (isMobile) setPanelOpen(true) }
    // Clicking the row DRILLS (expands/collapses its children) — it does NOT pop
    // the graph, so the user can keep navigating sub-categories. The chart button
    // opens the analysis; a leaf row (nothing to drill) opens it on click.
    const handleRowClick = () => {
      if (hasChildren) setExpanded(p => ({ ...p, [cat.id]: !p[cat.id] }))
      else openInsights()
    }

    return (
      <div>
        <div onClick={isEditing ? undefined : handleRowClick}
          role={isEditing ? undefined : 'button'} tabIndex={isEditing ? undefined : 0}
          onKeyDown={isEditing ? undefined : (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick() } })}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: `9px 16px 9px ${16 + depth * 24}px`,
            borderBottom: '1px solid var(--border)',
            cursor: isEditing ? 'default' : 'pointer',
            background: isSelected ? 'var(--accent-bg)' : depth === 0 ? 'var(--panel)' : depth === 1 ? 'var(--panel-2)' : 'rgba(0,0,0,0.02)',
            boxShadow: isSelected ? 'inset 3px 0 0 var(--accent)' : 'none',
          }}>
          {hasChildren || depth < 2 ? (
            <span style={{ color:'var(--text-mute)', padding:'2px', display:'flex', alignItems:'center', flexShrink:0 }}>
              {hasChildren ? isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span style={{ width:17, display:'inline-block' }} />}
            </span>
          ) : <span style={{ width:21, display:'inline-block' }} />}

          <Tag size={12} style={{ color: depth === 0 ? 'var(--accent)' : depth === 1 ? '#7c3aed' : '#059669', flexShrink:0 }} />

          {isEditing ? (
            <>
              <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Enter') updateCategory(cat.id); if (e.key === 'Escape') { setEditId(null); setEditName('') } }}
                style={{ ...FS_INLINE, flex:1, maxWidth:'260px' }} dir="auto" />
              <button onClick={e => { e.stopPropagation(); updateCategory(cat.id) }} disabled={saving} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ok)', display:'flex', padding:'2px' }}><Check size={15} /></button>
              <button onClick={e => { e.stopPropagation(); setEditId(null); setEditName('') }} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', display:'flex', padding:'2px' }}><X size={14} /></button>
            </>
          ) : (
            <>
              <span style={{ flex:1, minWidth:0, fontSize: depth === 0 ? '17px' : '16px', fontWeight: depth === 0 ? 600 : 500, color: isSelected ? 'var(--accent)' : 'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cat.name}</span>
              {children.length > 0 && <span style={{ fontSize:'11px', color:'var(--text-mute)', background:'var(--panel-2)', border:'1px solid var(--border)', borderRadius:'999px', padding:'1px 8px', flexShrink:0 }}>{children.length}</span>}
            </>
          )}

          {!isEditing && (
            <div style={{ display:'flex', gap:'2px', flexShrink:0, opacity:0.85 }}>
              <button onClick={e => { e.stopPropagation(); openInsights() }} title="הצג ניתוח / גרף"
                style={{ padding:'4px 6px', background:'none', border:'none', cursor:'pointer', color:'var(--accent)', borderRadius:'6px', display:'flex', alignItems:'center' }}
                onMouseEnter={e=>e.currentTarget.style.background='var(--panel-2)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                <PieChart size={14} />
              </button>
              {depth < 2 && (
                <button onClick={e => { e.stopPropagation(); setAddingTo({ parentId: cat.id, level: depth + 2 }); setExpanded(p => ({ ...p, [cat.id]: true })) }}
                  title="הוסף תת-קטגוריה"
                  style={{ padding:'4px 6px', background:'none', border:'none', cursor:'pointer', color:'var(--accent)', borderRadius:'6px', fontSize:'11px', display:'flex', alignItems:'center', gap:'3px' }}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--panel-2)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                  <Plus size={12} />
                </button>
              )}
              <button onClick={e => { e.stopPropagation(); setEditId(cat.id); setEditName(cat.name) }} title="עריכה"
                style={{ padding:'4px 6px', background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', borderRadius:'6px', display:'flex', alignItems:'center' }}
                onMouseEnter={e=>e.currentTarget.style.background='var(--panel-2)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                <Pencil size={12} />
              </button>
              <button onClick={e => { e.stopPropagation(); setDeleteId(cat.id) }} title="מחיקה"
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

  if (loading && categories.length === 0) return <LoadingSpinner />

  return (
    <div className="animate-fade-in" style={{ display:'flex', flexDirection:'column', gap:'24px', maxWidth:'1300px' }} dir="rtl">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
        <div>
          <h1 style={{ fontSize:'26px', fontWeight:700, color:'var(--text)', margin:0 }}>קטגוריות הוצאות</h1>
          <p style={{ fontSize:'15px', color:'var(--text-mute)', marginTop:'4px' }}>ניהול עץ הקטגוריות ההיררכי — עד 3 רמות</p>
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={() => runRecategorize(false)} disabled={recatBusy} title="סווג מחדש את כל הקבלות לפי עץ הקטגוריות הנוכחי"
            style={{ display:'flex', alignItems:'center', gap:'7px', padding:'9px 16px', background:'var(--panel)', color:'var(--text-dim)', border:'1px solid var(--border)', borderRadius:'var(--r-btn)', fontSize:'14px', fontWeight:600, cursor: recatBusy ? 'default' : 'pointer', fontFamily:'var(--font-main)', opacity: recatBusy ? 0.6 : 1 }}>
            <RefreshCw size={15} className={recatBusy ? 'animate-spin' : ''} /> {recatBusy ? 'מסווג…' : 'סווג קבלות מחדש'}
          </button>
          <button onClick={() => { setAddingTo({ parentId: null, level: 1 }); setNewName('') }}
            style={{ display:'flex', alignItems:'center', gap:'8px', padding:'9px 18px', background:'var(--accent)', color:'white', border:'none', borderRadius:'var(--r-btn)', fontSize:'15px', fontWeight:600, cursor:'pointer', fontFamily:'var(--font-main)' }}>
            <Plus size={16} /> הוספת קטגוריה
          </button>
        </div>
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

      <div style={{ display:'flex', gap:'20px', alignItems:'flex-start' }}>
        <div style={{ flex:1, minWidth:0, background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'var(--r-hero)', boxShadow:'var(--shadow-card)', overflow:'hidden' }}>
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
        {/* Desktop: sticky insight panel beside the tree */}
        {!isMobile && (
          <aside style={{ width:400, flexShrink:0, position:'sticky', top:20, maxHeight:'calc(100dvh - 40px)', overflowY:'auto', background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'var(--r-hero)', boxShadow:'var(--shadow-card)', padding:'16px' }}>
            <CategoryInsightPanel node={selectedNode} path={selectedNode ? nodePath(categories, selectedNode) : []} flatItems={flatItems} onJumpVendor={jumpVendor} onJumpReceipts={jumpReceipts} />
          </aside>
        )}
      </div>

      {/* Mobile: insight panel as a bottom sheet */}
      {isMobile && (
        <Modal isOpen={panelOpen} onClose={() => setPanelOpen(false)} title="ניתוח קטגוריה" size="lg">
          <CategoryInsightPanel node={selectedNode} path={selectedNode ? nodePath(categories, selectedNode) : []} flatItems={flatItems} onJumpVendor={jumpVendor} onJumpReceipts={jumpReceipts} />
        </Modal>
      )}

      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={deleteCategory}
        title="מחיקת קטגוריה" message="האם למחוק את הקטגוריה? תתי-קטגוריות יאבדו את הקישור." />
    </div>
  )
}
