"use client";
import {useRef,useState} from 'react';
import {Check,Cloud,CloudOff,Pencil,Plus,RefreshCw,Trash2,Users,X} from 'lucide-react';
import {useFrequentPlayers} from './useFrequentPlayers';
export default function FrequentPlayers(){
 const {names,ready,saving,error,save,remove,retry,account,pending,syncing,syncError,sync}=useFrequentPlayers();
 const [draft,setDraft]=useState(''),[editDraft,setEditDraft]=useState(''),[editing,setEditing]=useState<string|null>(null),[removed,setRemoved]=useState<string|null>(null),[message,setMessage]=useState('');
 const addInput=useRef<HTMLInputElement>(null);
 const ordered=[...names].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
 async function add(){if(await save(draft)){setMessage(`${draft.trim()} added.`);setDraft('');setRemoved(null);addInput.current?.focus()}}
 async function rename(){if(editing&&await save(editDraft,editing)){setMessage('Player name updated.');setEditing(null);addInput.current?.focus()}}
 async function removePlayer(name:string){if(await remove(name)){setRemoved(name);setMessage('');addInput.current?.focus();if(editing===name)setEditing(null)}}
 async function undo(){if(removed&&await save(removed)){setMessage(`${removed} restored.`);setRemoved(null)}}
 return <section className="card panel frequent-players" aria-labelledby="frequent-players-title">
  <div className="fp-heading"><h2 id="frequent-players-title">Frequent players</h2><span className="fp-count" aria-label={`${names.length} saved players`}>{names.length}</span></div>
  <p className="fp-description">Keep your regular players ready for the next game.</p>
  <form className="fp-add-form" onSubmit={event=>{event.preventDefault();if(ready&&!saving&&draft.trim())void add()}}>
   <label htmlFor="frequent-player-name">Add a player</label>
   <div className="fp-add-row"><input ref={addInput} id="frequent-player-name" placeholder="Player name" value={draft} onChange={event=>setDraft(event.target.value)} maxLength={30} disabled={!ready||saving} autoComplete="off"/><button type="submit" className="primary fp-add-button" disabled={!ready||saving||!draft.trim()}><Plus size={17} aria-hidden="true"/>Add</button></div>
  </form>
  {removed&&<div className="fp-feedback" role="status"><span><strong>{removed}</strong> removed.</span><button type="button" className="fp-text-button" disabled={saving} onClick={()=>void undo()}>Undo</button></div>}
  {message&&<p className="fp-feedback" role="status">{message}</p>}
  {error&&<p className="error fp-error" role="alert">{error}</p>}
  {!ready&&<div className="fp-empty"><p>{error?'Your saved list is safe. Try loading it again.':'Loading your players…'}</p>{error&&<button type="button" className="outline" onClick={()=>void retry()}>Retry</button>}</div>}
  {ready&&!names.length&&<div className="fp-empty"><Users size={26} aria-hidden="true"/><strong>Your regulars belong here</strong><p>Add a name above. Pick saved players when you start a new game.</p></div>}
  {names.length>0&&<ul className="fp-list" aria-label="Saved players">{ordered.map(name=><li className="fp-row" key={name}>{editing===name?<form className="fp-edit-form" onSubmit={event=>{event.preventDefault();if(!saving&&editDraft.trim())void rename()}}><label className="fp-edit-label" htmlFor="fp-edit-name">Edit player</label><div className="fp-edit-row"><input id="fp-edit-name" autoFocus aria-label={`New name for ${name}`} value={editDraft} onChange={event=>setEditDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setEditing(null);addInput.current?.focus()}}} maxLength={30} disabled={saving} autoComplete="off"/><button type="submit" className="fp-text-button" disabled={saving||!editDraft.trim()}><Check size={16} aria-hidden="true"/>Save</button><button type="button" className="fp-icon-button" aria-label="Cancel name edit" title="Cancel" disabled={saving} onClick={()=>{setEditing(null);addInput.current?.focus()}}><X size={18} aria-hidden="true"/></button></div></form>:<><span className="fp-avatar" aria-hidden="true">{name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()}</span><span className="fp-player-name">{name}</span><div className="fp-row-actions"><button type="button" className="fp-icon-button" disabled={saving} aria-label={`Edit ${name}`} title={`Edit ${name}`} onClick={()=>{setEditing(name);setEditDraft(name);setMessage('')}}><Pencil size={17} aria-hidden="true"/></button><button type="button" className="fp-icon-button fp-remove" disabled={saving} aria-label={`Remove ${name} from frequent players`} title={`Remove ${name}`} onClick={()=>void removePlayer(name)}><Trash2 size={17} aria-hidden="true"/></button></div></>}</li>)}</ul>}
  <div className="fp-sync"><div className="fp-sync-state" role="status">{account?(syncError?<CloudOff size={16} aria-hidden="true"/>:syncing?<RefreshCw className="fp-spin" size={16} aria-hidden="true"/>:<Cloud size={16} aria-hidden="true"/>):<Users size={16} aria-hidden="true"/>}<span>{account?(syncing?'Syncing…':syncError?'Saved here · sync paused':pending?`${pending} ${pending===1?'change':'changes'} waiting to sync`:'Synced across devices'):'Saved on this device'}</span></div>{account&&<button type="button" className="fp-text-button" disabled={syncing||saving} onClick={()=>void sync().catch(()=>{})}>{syncError?'Retry sync':'Sync now'}</button>}</div>
  {!account&&<p className="fp-footnote">Sign in to share your list across devices.</p>}
  <p className="fp-footnote">Editing this list won’t change names in existing games.</p>
 </section>
}
