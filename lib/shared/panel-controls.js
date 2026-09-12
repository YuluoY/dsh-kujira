import {cleanNickname} from "./client/utilities.js";
import {element, t, number, parseNumber, getLocale} from './i18n.js';
/**
 * @description Small, dependency-free React controls for the DSH companion.
 */
export function floatingPosition(anchor, size, viewport, gap = 6) {
    const edge = 8;
    const width = Math.min(size.width, viewport.width - edge * 2);
    const below = viewport.height - anchor.bottom - gap - edge;
    const above = anchor.top - gap - edge;
    const up = below < size.height && above > below;
    const height = Math.max(0, Math.min(size.height, up ? above : below));
    return { left: Math.max(edge, Math.min(anchor.right - width, viewport.width - width - edge)),
        top: up ? anchor.top - gap - height : anchor.bottom + gap, width, maxHeight: height };
}

export function bubbleOutline(width, height, anchorY, pointer = true, diagonal = false) {
    const radius = Math.min(18, height / 3);
    const half = Math.min(10, Math.max(3, (height - radius * 2) / 2 - 1));
    const y = Math.max(radius + half, Math.min(anchorY, height - radius - half));
    const drop = diagonal ? half * .45 : 0;
    const tip = pointer ? `V${y-half} C${width} ${y-half*.5} ${width+2} ${y-half*.4} ${width+7} ${y-1+drop} Q${width+9} ${y+drop} ${width+7} ${y+1+drop} C${width+2} ${y+half*.4} ${width} ${y+half*.5} ${width} ${y+half} ` : '';
    return `M${radius} 0 H${width-radius} Q${width} 0 ${width} ${radius} ${tip}V${height-radius} Q${width} ${height} ${width-radius} ${height} H${radius} Q0 ${height} 0 ${height-radius} V${radius} Q0 0 ${radius} 0 Z`;
}

export function beginRefresh(previous) {
    return previous?.ok ? {...previous, refreshing:true, refreshError:''} : {loading:true};
}
export function finishRefresh(previous, result) {
    return result.ok ? {...result, loading:false, refreshing:false} : previous?.ok
        ? {...previous, refreshing:false, refreshError:result.message || '更新失败，保留上次数据'}
        : {...result, loading:false, refreshing:false};
}

export function createControls(React) {
    const {useId, useState, useRef, useEffect, useLayoutEffect} = React;
    const h = (type, props, ...children) => element(React, type, props, ...children);
    const chevron = h('svg', {viewBox:'0 0 16 16', 'aria-hidden':true}, h('path',{d:'m4 6 4 4 4-4',fill:'none',stroke:'currentColor',strokeWidth:1.4}));
    const check = h('svg', {viewBox:'0 0 16 16', 'aria-hidden':true}, h('path',{d:'m3 8 3 3 7-7',fill:'none',stroke:'currentColor',strokeWidth:1.4}));

    /**
     * @description Select-only combobox. Focus stays on trigger; active option is announced.
     */
    function Select({label, value, options, onChange, disabled=false, loading=false, error=''}) {
        options = options.map(([value, label]) => [value, t(label)]);
        const id = useId(), box = useRef(null), trigger = useRef(null), list = useRef(null);
        const [open,setOpen] = useState(false), [active,setActive] = useState(0);
        const search = useRef({text:'',time:0});
        const selected = Math.max(0, options.findIndex(o=>o[0] === value));
        const unavailable = disabled || loading || options.length === 0;
        const close = () => setOpen(false);
        const commit = index => { if (options[index]) onChange(options[index][0]); close(); };
        useEffect(()=>{if(unavailable) close();},[unavailable]);
        useLayoutEffect(()=>{
            if(!open) return;
            const popup=list.current;
            popup.showPopover();
            const place=()=>{
                const rect=trigger.current.getBoundingClientRect();
                const pos=floatingPosition(rect,{width:Math.max(164,rect.width),height:options.length*(innerWidth<=600?40:34)+8},{width:innerWidth,height:innerHeight});
                Object.assign(popup.style,{left:pos.left+'px',top:pos.top+'px',width:pos.width+'px',maxHeight:pos.maxHeight+'px'});
            };
            place();
            const outside=e=>{if(!box.current.contains(e.target)) close();};
            const toggle=e=>{if(e.target.tagName==='DETAILS' && !e.target.open && e.target.contains(box.current)) close();};
            document.addEventListener('pointerdown',outside,true);
            document.addEventListener('toggle',toggle,true);
            window.addEventListener('resize',close);
            const scroll=e=>{if(!popup.contains(e.target)) close();};
            document.addEventListener('scroll',scroll,true);
            return ()=>{if(popup.matches(':popover-open')) popup.hidePopover();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('toggle',toggle,true);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',close);};
        },[open,options.length]);
        useLayoutEffect(()=>{if(open) list.current?.children[active]?.scrollIntoView({block:'nearest'});},[active,open]);
        const keys=e=>{
            if(unavailable) return;
            if(e.key==='Escape' && open){e.preventDefault();e.stopPropagation();close();return;}
            if(e.key==='Tab'){if(open) commit(active);return;}
            if(['Enter',' ','ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
                e.preventDefault();e.stopPropagation();
                if(!open){setActive(e.key==='End'?options.length-1:e.key==='Home'?0:selected);setOpen(true);return;}
                if(e.key==='Enter'||e.key===' '){commit(active);return;}
                setActive(i=>e.key==='Home'?0:e.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,i+(e.key==='ArrowDown'?1:-1))));
            } else if(e.key.length===1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const now=Date.now();search.current={text:(now-search.current.time<700?search.current.text:'')+e.key,time:now};
                const index=options.findIndex(o=>String(o[1]).toLocaleLowerCase().startsWith(search.current.text.toLocaleLowerCase()));
                if(index>=0){setActive(index);setOpen(true);}
            }
        };
        return h('div',{className:'kj-select',ref:box},
            h('button',{ref:trigger,type:'button',className:'kj-select-trigger',role:'combobox',
                'aria-label':label,'aria-expanded':open,'aria-haspopup':'listbox','aria-controls':open?id:undefined,
                'aria-activedescendant':open?id+'-'+active:undefined,'aria-invalid':!!error,'aria-describedby':error?id+'-error':undefined,
                disabled:unavailable,onKeyDown:keys,onClick:()=>{setActive(selected);setOpen(!open);}},
                h('span',null,loading?'正在加载…':options.length?options[selected][1]:'暂无可选项'),h('span',{'data-tooltip':t('选择{label}', {label:t(label)})},chevron)),
            open?h('div',{ref:list,id,popover:'manual',role:'listbox','aria-label':label,className:'kj-select-list'},
                options.map(([v,text],i)=>h('div',{key:v,id:id+'-'+i,role:'option','aria-selected':v===value,
                    'data-active':i===active?'1':'0',className:'kj-select-option',onPointerMove:()=>setActive(i),
                    onPointerDown:e=>e.preventDefault(),onClick:()=>{commit(i);trigger.current.focus();}},h('span',null,text),v===value?check:null))) : null,
            error?h('span',{id:id+'-error',className:'err',role:'status'},error):null);
    }

    function NumberField({label, value, onChange, min=0, max=Infinity, step=1, disabled=false, integer=false}) {
        const input = useRef(null);
        const [draft,setDraft]=useState(() => number(value, {useGrouping:false,maximumFractionDigits:6}));
        const locale = getLocale();
        const formatted = n => number(n, {useGrouping:false,maximumFractionDigits:6});
        const clampValue = n => Math.min(max,Math.max(min,integer?Math.round(n):n));
        useEffect(()=>{if(document.activeElement!==input.current)setDraft(formatted(value));},[value,locale]);
        const nudge=direction=>{const next=Math.min(max,Math.max(min,Number((value+direction*step).toFixed(6))));setDraft(formatted(next));onChange(next);};
        const symbol=plus=>h('svg',{viewBox:'0 0 16 16','aria-hidden':true},h('path',{d:plus?'M3 8h10M8 3v10':'M3 8h10',fill:'none',stroke:'currentColor',strokeWidth:1.4}));
        return h('div',{className:'kj-number'},
            h('button',{type:'button','aria-label':t('减少{label}', {label:t(label)}),'data-tooltip':t('减少{label}', {label:t(label)}),disabled:disabled||value<=min,onClick:()=>nudge(-1)},symbol(false)),
            h('input',{ref:input,type:'text',inputMode:integer?'numeric':'decimal',role:'spinbutton','aria-label':label,'aria-valuemin':min,'aria-valuemax':Number.isFinite(max)?max:undefined,'aria-valuenow':value,value:draft,disabled,onKeyDown:e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();nudge(e.key==='ArrowUp'?1:-1);}if(e.key==='Enter')e.currentTarget.blur();},onChange:e=>{setDraft(e.currentTarget.value);const n=parseNumber(e.currentTarget.value);if(Number.isFinite(n)&&n>=min)onChange(clampValue(n));},onBlur:()=>{const n=parseNumber(draft);const next=Number.isFinite(n)?clampValue(n):value;setDraft(formatted(next));onChange(next);}}),
            h('button',{type:'button','aria-label':t('增加{label}', {label:t(label)}),'data-tooltip':t('增加{label}', {label:t(label)}),disabled:disabled||value>=max,onClick:()=>nudge(1)},symbol(true)));
    }

    function Range({label, labelNode, value, min, max, unit='', onChange}) {
        const input=useRef(null), tip=useRef(null), id=useId();
        const [hover,setHover]=useState(false), [focus,setFocus]=useState(false), [drag,setDrag]=useState(false);
        const ratio=Math.max(0,Math.min(1,(value-min)/(max-min)));
        const visible=hover||focus||drag;
        useEffect(()=>{if(!drag)return;const end=()=>setDrag(false);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);return()=>{window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);};},[drag]);
        useLayoutEffect(()=>{
            if(!visible)return;
            const el=tip.current;
            el.showPopover();
            const place=()=>{const r=input.current.getBoundingClientRect();el.style.left=Math.max(8,Math.min(r.left+6+(r.width-12)*ratio-el.offsetWidth/2,innerWidth-el.offsetWidth-8))+'px';el.style.top=Math.max(8,r.top-el.offsetHeight-7)+'px';};
            place();window.addEventListener('resize',place);document.addEventListener('scroll',place,true);
            return()=>{if(el.matches(':popover-open'))el.hidePopover();window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);};
        },[visible,ratio,value]);
        return h('div',{className:'kj-slider-row'}, labelNode || h('span',null,label),
            h('input',{ref:input,className:'kj-slider',type:'range',min,max,value,'aria-label':label,'aria-valuetext':(unit==='%' ? number(value/100,{style:'percent',maximumFractionDigits:0}) : number(value)+unit),'aria-describedby':visible?id:undefined,
                style:{'--kj-progress':ratio*100+'%'},onChange:e=>onChange(Number(e.currentTarget.value)),onPointerEnter:()=>setHover(true),onPointerLeave:()=>setHover(false),onFocus:()=>setFocus(true),onBlur:()=>setFocus(false),onPointerDown:()=>setDrag(true)}),
            h('output',{className:'kj-slider-value','aria-hidden':true},(unit==='%' ? number(value/100,{style:'percent',maximumFractionDigits:0}) : number(value)+unit)),
            visible?h('div',{ref:tip,id,popover:'manual',role:'tooltip',className:'kj-tooltip kj-slider-tip'},(unit==='%' ? number(value/100,{style:'percent',maximumFractionDigits:0}) : number(value)+unit)):null);
    }

    /**
     * @description Shaped placeholders; the outer panel owns the stable viewport dimensions.
     */
    function Skeleton({kind='balance',label='正在加载'}) {
        const line=(size,key)=>h('i',{key,className:'kj-skeleton-line is-'+size});
        const blocks=kind==='settings'
            ? Array.from({length:4},(_,i)=>h('div',{key:i,className:'kj-skeleton-row'},line('label','l'),line('control','c')))
            : kind==='usage' ? [h('div',{key:'offpeak',className:'kj-skeleton-row'},line('label','l'),line('medium','v')),h('div',{key:'peak',className:'kj-skeleton-row'},line('label','l'),line('medium','v')),h('div',{key:'sum',className:'kj-skeleton-row'},line('label','l'),line('value','v'))]
            : kind==='balance' ? [
                h('div',{key:'label',className:'kj-balance-heading'},line('label','l'),line('short','c')),
                h('div',{key:'total',className:'kj-skeleton-row'},line('value','v')),
                h('div',{key:'split',className:'kj-skeleton-columns'},[0,1].map(i=>h('div',{key:i},line('label','l'),line('medium','v')))),
                h('div',{key:'updated',className:'kj-caption'},line('note','n'))]
            : [h('div',{key:'heading',className:'kj-skeleton-row'},line('value','v'),line('short','s')),
                line('note','note'),
                h('div',{key:'metrics',className:'kj-skeleton-columns'},Array.from({length:kind==='growth'?3:2},(_,i)=>h('div',{key:i},line('label','l'),line('medium','v')))),
                kind==='growth'?h('div',{key:'actions',className:'kj-skeleton-columns'},Array.from({length:4},(_,i)=>line('control',i))):null];
        return h('div',{className:'kj-skeleton','data-kind':kind,role:'status','aria-label':label},h('div',{'aria-hidden':true},blocks));
    }

    /**
     * @description Delegated tooltip, in the top layer so panel scrolling cannot clip it.
     */
    function TooltipHost({rootRef}) {
        const tooltip=useRef(null), id=useId();
        useEffect(()=>{
            const root=rootRef.current, el=tooltip.current;
            let timer=0, hideTimer=0, target=null;
            const hide=()=>{clearTimeout(hideTimer);clearTimeout(timer);if(target)target.removeAttribute('aria-describedby');target=null;if(el.matches(':popover-open'))el.hidePopover();};
            const show=(node,immediate=false)=>{
                if(node===target)return;
                hide();target=node;
                const render=()=>{
                    if(!node.isConnected){hide();return;}
                    el.textContent=node.dataset.tooltip;el.dataset.scrollable=node.dataset.tooltipLong || "false";
                    const style=getComputedStyle(node);
                    ['--kj-surface','--kj-ink','--kj-text','--kj-line-strong'].forEach(key=>el.style.setProperty(key,style.getPropertyValue(key)));
                    el.showPopover();node.setAttribute('aria-describedby',id);
                    const r=node.getBoundingClientRect(),w=el.offsetWidth,hh=el.offsetHeight;
                    el.style.left=Math.max(8,Math.min(r.left+(r.width-w)/2,innerWidth-w-8))+'px';
                    el.style.top=(r.top>hh+14?r.top-hh-8:Math.min(innerHeight-hh-8,r.bottom+8))+'px';
                    if(node.dataset.tooltipLong==='true') {
                        const panel=node.closest('.dsh-kujira-panel')?.getBoundingClientRect();
                        if(panel && (panel.left>w+16 || innerWidth-panel.right>w+16)) {
                            el.style.left=(panel.left>w+16?panel.left-w-8:panel.right+8)+'px';
                            el.style.top=Math.max(8,Math.min(r.top,innerHeight-hh-8))+'px';
                        }
                    }
                };
                if(immediate)render();else timer=setTimeout(render,320);
            };
            const enter=e=>{if(e.type==='focusin'&&!e.target.matches(':focus-visible'))return;const node=e.target.closest?.('[data-tooltip]') || (e.type==='focusin' ? e.target.querySelector?.('[data-tooltip]') : null);if(node&&root.contains(node))show(node,e.type==='focusin');};
            const click=e=>{const node=e.target.closest?.('.kj-help[data-tooltip]');if(node&&root.contains(node))show(node,true);};
            const outside=e=>{if(!root.contains(e.target))hide();};
            const leave=e=>{if(target&&(target.contains(e.target)||el.contains(e.target))&&!target.contains(e.relatedTarget)&&!el.contains(e.relatedTarget))hideTimer=setTimeout(hide,160);};
            const keep=()=>clearTimeout(hideTimer);
            const press=e=>{if(!el.contains(e.target))hide();};
            const scroll=e=>{if(!el.contains(e.target))hide();};
            const escape=e=>{if(e.key==='Escape')hide();};
            const observer=new MutationObserver(()=>{if(target&&(!target.isConnected||!target.dataset.tooltip||(target.closest('.dsh-kujira-orbs')&&root.dataset.orb!=='1')))hide();else if(target&&el.matches(':popover-open')&&el.textContent!==target.dataset.tooltip){const current=target;hide();show(current,true);}});
            observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['data-orb','data-tooltip']});
            root.addEventListener('click',click);document.addEventListener('pointerdown',outside);root.addEventListener('pointerover',enter);root.addEventListener('focusin',enter);
            root.addEventListener('pointerout',leave);root.addEventListener('focusout',leave);root.addEventListener('pointerdown',press);el.addEventListener('pointerenter',keep);el.addEventListener('pointerleave',leave);
            document.addEventListener('keydown',escape);window.addEventListener('resize',hide);document.addEventListener('scroll',scroll,true);
            return()=>{observer.disconnect();hide();root.removeEventListener('click',click);document.removeEventListener('pointerdown',outside);root.removeEventListener('pointerover',enter);root.removeEventListener('focusin',enter);root.removeEventListener('pointerout',leave);root.removeEventListener('focusout',leave);root.removeEventListener('pointerdown',press);el.removeEventListener('pointerenter',keep);el.removeEventListener('pointerleave',leave);document.removeEventListener('keydown',escape);window.removeEventListener('resize',hide);document.removeEventListener('scroll',scroll,true);};
        },[rootRef,id]);
        return h('div',{ref:tooltip,id,popover:'manual',role:'tooltip',className:'kj-tooltip'});
    }
    function CareAction({readyAt=0,disabled,children,...props}) {
        const [now,setNow]=useState(Date.now());
        useEffect(()=>{setNow(Date.now());if(readyAt<=Date.now())return;const timer=setInterval(()=>{setNow(Date.now());if(Date.now()>=readyAt)clearInterval(timer);},200);return()=>clearInterval(timer);},[readyAt]);
        const remaining=Math.max(0,Math.ceil((readyAt-now)/1000));
        return h('button',{...props,disabled:disabled||remaining>0,'data-cooling':remaining>0?'true':undefined,'aria-label':remaining?t('{label}，{seconds} 秒后可用',{label:t(props['aria-label']),seconds:number(remaining)}):props['aria-label']},children,remaining?h('span',{className:'kj-care-cooldown','aria-hidden':true},number(remaining)+'s'):null);
    }
    function Nickname({value,onChange}) {
        const [draft,setDraft]=useState(value || "");
        useEffect(()=>setDraft(value || ""),[value]);
        const commit=()=>{const next=cleanNickname(draft);setDraft(next);onChange(next);};
        return h('input',{type:'text',className:'kj-nickname','aria-label':t('称呼'),value:draft,maxLength:96,placeholder:t('自动'),
            onChange:e=>setDraft(e.target.value),onBlur:commit,onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent?.isComposing){e.preventDefault();e.currentTarget.blur();}}});
    }
    function HelpLabel({label,help}) {
        return h('span',{className:'kj-field-caption'},h('span',{className:'kj-label-text'},h('span',{className:'kj-help-copy'},label),help?h('button',{type:'button',className:'kj-help','aria-label':t('{label}说明',{label:t(label)}),'data-tooltip':help},h('svg',{viewBox:'0 0 16 16','aria-hidden':true},h('circle',{cx:8,cy:8,r:6,fill:'none',stroke:'currentColor',strokeWidth:1.2}),h('path',{d:'M6.5 6a1.5 1.5 0 0 1 3 0c0 1-1.5 1-1.5 2.5M8 11v.1',fill:'none',stroke:'currentColor',strokeWidth:1.2,strokeLinecap:'round'}))):null));
    }
    function Disclosure({label,children,name,count}) {
        return h('details',{className:'kj-disclosure',name,onToggle:e=>{if(e.currentTarget.open)e.currentTarget.closest('[data-panel]')?.querySelectorAll('.kj-disclosure').forEach(other=>{if(other!==e.currentTarget && other.name===name)other.open=false;});}},
            h('summary',null,h('span',{className:'kj-disclosure-label'},label),count!=null?h('span',{className:'kj-disclosure-count'},number(count)):null,h('span',{className:'kj-chevron','aria-hidden':true},chevron)),h('div',{className:'kj-detail'},children));
    }
    return {CareAction,Nickname,HelpLabel,Disclosure,Select,NumberField,Range,Skeleton,TooltipHost,beginRefresh,finishRefresh};
}
