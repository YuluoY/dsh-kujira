import {createSearchSelect, isSelectAnchorScroll} from "./client/search-select.js";
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
    return result.ok ? {...result, loading:false, refreshing:false} : previous?.ok && !result.discardPrevious
        ? {...previous, refreshing:false, refreshError:result.message || '更新失败，保留上次数据'}
        : {...result, loading:false, refreshing:false};
}

export function createControls(React) {
    const {useId, useState, useRef, useEffect, useLayoutEffect} = React;
    const h = (type, props, ...children) => element(React, type, props, ...children);
    const SearchSelect = createSearchSelect(React, {h, t, position:floatingPosition});
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
            window.addEventListener('resize',place);
            const scroll=e=>{if(isSelectAnchorScroll(e.target,box.current,document)) place();};
            document.addEventListener('scroll',scroll,true);
            return ()=>{if(popup.matches(':popover-open')) popup.hidePopover();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('toggle',toggle,true);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',place);};
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

    /**
     * @description Controlled text field with composition-safe commit and an optional trailing action.
     */
    function TextField({label,value='',onChange,onCommit,placeholder='',help='',error='',disabled=false,loading=false,readOnly=false,clearable=false,type='text',maxLength=200,action,hideLabel=false}) {
        const id=useId(), input=useRef(null), composing=useRef(false);
        const unavailable=disabled||loading;
        const commit=e=>{if(!unavailable&&!readOnly&&!composing.current)onCommit?.(e.currentTarget.value);};
        return h('div',{className:'kj-text-field','data-invalid':!!error},
            hideLabel?null:h('div',{className:'kj-text-label'},h(HelpLabel,{label,help,htmlFor:id})),
            h('div',{className:'kj-text-control','data-disabled':unavailable},
                h('input',{ref:input,id,type,value,placeholder,readOnly,disabled:unavailable,maxLength,spellCheck:false,
                    'aria-label':label,'aria-invalid':!!error,'aria-busy':loading,'aria-describedby':error||help?id+'-help':undefined,
                    onChange:e=>onChange?.(e.currentTarget.value),onBlur:commit,
                    onCompositionStart:()=>{composing.current=true;},onCompositionEnd:()=>{composing.current=false;},
                    onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent?.isComposing&&!composing.current){e.preventDefault();e.currentTarget.blur();}}}),
                clearable&&value&&!readOnly?h('button',{type:'button',className:'kj-text-action','aria-label':t('清除{label}',{label:t(label)}),disabled:unavailable,
                    onPointerDown:e=>e.preventDefault(),onClick:()=>{onChange?.('');input.current?.focus();}},
                    h('svg',{viewBox:'0 0 16 16','aria-hidden':true},h('path',{d:'m4 4 8 8m0-8-8 8',fill:'none',stroke:'currentColor',strokeWidth:1.4}))):null,
                action?h('button',{type:'button',className:'kj-text-action','aria-label':action.label,disabled:unavailable,onClick:action.onClick},action.icon||action.label):null),
            error?h('p',{id:id+'-help',className:'kj-field-error',role:'status'},error):help?h('span',{id:id+'-help',className:'kj-visually-hidden'},help):null);
    }

    /**
     * @description Lazily mount one settings category with keyboard-accessible tabs.
     */
    function SettingsTabs({items,label='设置分类'}) {
        const id=useId(), [selected,setSelected]=useState(items[0]?.id), content=useRef(null);
        const current=items.find(item=>item.id===selected)||items[0];
        const activate=value=>{if(value===selected)return;setSelected(value);if(content.current)content.current.scrollTop=0;};
        const keys=(event,index)=>{
            const offset=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
            if(!offset&&!['Home','End'].includes(event.key))return;
            event.preventDefault();
            const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+offset+items.length)%items.length;
            activate(items[next].id);event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
        };
        return h(React.Fragment,null,
            h('div',{className:'kj-settings-tabs',role:'tablist','aria-label':label},items.map((item,index)=>h('button',{
                key:item.id,type:'button',role:'tab',id:id+'-'+item.id,'aria-controls':id+'-content','aria-selected':item===current,
                tabIndex:item===current?0:-1,onClick:()=>activate(item.id),onKeyDown:event=>keys(event,index)},item.label))),
            h('div',{ref:content,className:'kj-body kj-settings-content',role:'tabpanel',id:id+'-content','aria-labelledby':id+'-'+current?.id,tabIndex:0},current?.render()));
    }

    /**
     * @description Group related settings without adding another disclosure level.
     */
    function SettingsSection({title,children}) {
        const id=useId();
        return h('section',{className:'kj-settings-section','aria-labelledby':id},h('h3',{id},title),h('div',{className:'kj-settings-fields'},children));
    }

    function NumberField({label, value, onChange, min=0, max=Number.MAX_SAFE_INTEGER, step=1, disabled=false, integer=false, unit="", prefix=false}) {
        const input = useRef(null), composing = useRef(false);
        const locale = getLocale();
        const formatted = n => number(n, {useGrouping:false,maximumFractionDigits:6});
        const normalize = n => normalizeNumber(n, {min,max,step,integer});
        const current = normalize(value) ?? min;
        const [draft,setDraft]=useState(() => formatted(current));
        useEffect(()=>{if(document.activeElement!==input.current)setDraft(formatted(current));},[current,locale]);
        const commit = raw => {
            if(disabled || composing.current)return;
            const next=normalize(parseNumber(raw.normalize('NFKC'))) ?? current;
            setDraft(formatted(next));
            if(next!==current)onChange(next);
        };
        const edit = raw => {
            if(disabled)return;
            if(composing.current){setDraft(raw);return;}
            raw=raw.normalize('NFKC');
            if(raw.trim()==='' || (!integer && ['.',','].includes(raw)) || (min<0 && raw==='-')){setDraft(raw);return;}
            const n=parseNumber(raw);
            if(!Number.isFinite(n) || (integer && !Number.isInteger(n))){setDraft(formatted(current));return;}
            const next=normalize(n);
            if(next===null)return;
            setDraft(n>max || n<0 && min>=0 || n!==next && n>=min ? formatted(next) : raw);
            if(n>=min || n<0 && min>=0){if(next!==current)onChange(next);}
        };
        const nudge=direction=>{
            if(disabled || composing.current)return;
            const base=normalize(parseNumber(draft)) ?? current;
            const next=normalize(base+direction*step);
            setDraft(formatted(next));if(next!==current)onChange(next);
        };
        const symbol=plus=>h('svg',{viewBox:'0 0 16 16','aria-hidden':true},h('path',{d:plus?'M3 8h10M8 3v10':'M3 8h10',fill:'none',stroke:'currentColor',strokeWidth:1.4}));
        return h('div',{className:'kj-number'},
            h('button',{type:'button','aria-label':t('减少{label}', {label:t(label)}),'data-tooltip':t('减少{label}', {label:t(label)}),disabled:disabled||current<=min,onClick:()=>nudge(-1)},symbol(false)),
            h('span',{className:'kj-number-value'},prefix&&unit?h('span',{className:'kj-number-unit','aria-hidden':true},t(unit)):null,
            h('input',{ref:input,type:'text',inputMode:integer?'numeric':'decimal',maxLength:32,role:'spinbutton','aria-label':label,'aria-valuemin':min,'aria-valuemax':Number.isFinite(max)?max:undefined,'aria-valuenow':current,'aria-valuetext':unit?(prefix?t(unit)+' '+draft:draft+' '+t(unit)):undefined,value:draft,disabled,
                onCompositionStart:()=>{composing.current=true;},onCompositionEnd:e=>{composing.current=false;edit(e.currentTarget.value);},
                onKeyDown:e=>{if(e.nativeEvent?.isComposing || composing.current)return;if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();nudge(e.key==='ArrowUp'?1:-1);}if(e.key==='Enter')e.currentTarget.blur();},
                onChange:e=>edit(e.currentTarget.value),onBlur:e=>commit(e.currentTarget.value)}),!prefix&&unit?h('span',{className:'kj-number-unit','aria-hidden':true},t(unit)):null),
            h('button',{type:'button','aria-label':t('增加{label}', {label:t(label)}),'data-tooltip':t('增加{label}', {label:t(label)}),disabled:disabled||current>=max,onClick:()=>nudge(1)},symbol(true)));
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
                style:{'--kj-progress':ratio*100+'%'},onChange:e=>{const next=normalizeNumber(Number(e.currentTarget.value),{min,max,step:1,integer:true});if(next!==null)onChange(next);},onPointerEnter:()=>setHover(true),onPointerLeave:()=>setHover(false),onFocus:()=>setFocus(true),onBlur:()=>setFocus(false),onPointerDown:()=>setDrag(true)}),
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
            let timer=0, hideTimer=0, target=null, pointer=null;
            const inside=(node)=>{
                if(!node || !pointer)return false;
                const r=node.getBoundingClientRect();
                return pointer.x>=r.left-2&&pointer.x<=r.right+2&&pointer.y>=r.top-2&&pointer.y<=r.bottom+2;
            };
            const track=e=>{if(Number.isFinite(e.clientX)&&Number.isFinite(e.clientY))pointer={x:e.clientX,y:e.clientY};};
            const hide=()=>{clearTimeout(hideTimer);hideTimer=0;clearTimeout(timer);if(target)target.removeAttribute('aria-describedby');target=null;if(el.matches(':popover-open'))el.hidePopover();};
            const show=(node,immediate=false)=>{
                clearTimeout(hideTimer);hideTimer=0;
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
            const enter=e=>{track(e);if(el.matches(':popover-open')&&inside(el)){clearTimeout(hideTimer);return;}if(e.type==='focusin'&&!e.target.matches(':focus-visible'))return;const node=e.target.closest?.('[data-tooltip]') || (e.type==='focusin' ? e.target.querySelector?.('[data-tooltip]') : null);if(node&&root.contains(node))show(node,e.type==='focusin');};
            const click=e=>{const node=e.target.closest?.('.kj-help[data-tooltip]');if(node&&root.contains(node))show(node,true);};
            const outside=e=>{if(!root.contains(e.target)&&!el.contains(e.target))hide();};
            const leave=e=>{
                track(e);
                if(!target || !(target.contains(e.target)||el.contains(e.target)))return;
                clearTimeout(hideTimer);
                if(target.contains(e.relatedTarget)||el.contains(e.relatedTarget))return;
                hideTimer=setTimeout(()=>{
                    hideTimer=0;
                    if(inside(el)||inside(target)||target?.matches(':hover')||el.matches(':hover')||target?.matches(':focus-visible')||el.contains(document.activeElement))return;
                    hide();
                },300);
            };
            const keep=e=>{if(e)track(e);clearTimeout(hideTimer);hideTimer=0;};
            const move=e=>{if(!target)return;track(e);if(inside(el)||inside(target))keep();else if(!hideTimer)leave({target:el,relatedTarget:null});};
            const press=e=>{if(!el.contains(e.target))hide();};
            const scroll=e=>{if(el.contains(e.target)||inside(el))return;if(e.target===document||e.target?.contains?.(target))hide();};
            const escape=e=>{if(e.key==='Escape')hide();};
            const observer=new MutationObserver(()=>{if(target&&(!target.isConnected||!target.dataset.tooltip||(target.closest('.dsh-kujira-orbs')&&root.dataset.orb!=='1')))hide();else if(target&&el.matches(':popover-open')&&el.textContent!==target.dataset.tooltip){const current=target;hide();show(current,true);}});
            observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['data-orb','data-tooltip']});
            root.addEventListener('click',click);document.addEventListener('pointerdown',outside);root.addEventListener('pointerover',enter);root.addEventListener('focusin',enter);
            root.addEventListener('pointerout',leave);root.addEventListener('focusout',leave);root.addEventListener('pointerdown',press);el.addEventListener('pointerenter',keep);el.addEventListener('pointerleave',leave);
            document.addEventListener('pointermove',move,{passive:true});document.addEventListener('keydown',escape);window.addEventListener('resize',hide);document.addEventListener('scroll',scroll,true);
            return()=>{observer.disconnect();hide();root.removeEventListener('click',click);document.removeEventListener('pointerdown',outside);root.removeEventListener('pointerover',enter);root.removeEventListener('focusin',enter);root.removeEventListener('pointerout',leave);root.removeEventListener('focusout',leave);root.removeEventListener('pointerdown',press);el.removeEventListener('pointerenter',keep);el.removeEventListener('pointerleave',leave);document.removeEventListener('pointermove',move);document.removeEventListener('keydown',escape);window.removeEventListener('resize',hide);document.removeEventListener('scroll',scroll,true);};
        },[rootRef,id]);
        return h('div',{ref:tooltip,id,popover:'manual',role:'tooltip',className:'kj-tooltip'});
    }
    function Nickname({value,onChange}) {
        const [draft,setDraft]=useState(value || "");
        useEffect(()=>setDraft(value || ""),[value]);
        const commit=()=>{const next=cleanNickname(draft);setDraft(next);onChange(next);};
        return h('input',{type:'text',className:'kj-nickname','aria-label':t('称呼'),value:draft,maxLength:96,placeholder:t('自动'),
            onChange:e=>{setDraft(e.target.value);if(!e.nativeEvent?.isComposing)onChange(cleanNickname(e.target.value));},onCompositionEnd:e=>onChange(cleanNickname(e.currentTarget.value)),onBlur:commit,onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent?.isComposing){e.preventDefault();e.currentTarget.blur();}}});
    }
    function HelpLabel({label,help,htmlFor}) {
        return h('span',{className:'kj-field-caption'},h('span',{className:'kj-label-text'},h(htmlFor?'label':'span',{className:'kj-help-copy',htmlFor},label),help?h('button',{type:'button',className:'kj-help','aria-label':t('{label}说明',{label:t(label)}),'data-tooltip':help},h('svg',{viewBox:'0 0 16 16','aria-hidden':true},h('circle',{cx:8,cy:8,r:6,fill:'none',stroke:'currentColor',strokeWidth:1.2}),h('path',{d:'M6.5 6a1.5 1.5 0 0 1 3 0c0 1-1.5 1-1.5 2.5M8 11v.1',fill:'none',stroke:'currentColor',strokeWidth:1.2,strokeLinecap:'round'}))):null));
    }
    function Disclosure({label,children,name,count}) {
        return h('details',{className:'kj-disclosure',name,onToggle:e=>{if(e.currentTarget.open)e.currentTarget.closest('[data-panel]')?.querySelectorAll('.kj-disclosure').forEach(other=>{if(other!==e.currentTarget && other.name===name)other.open=false;});}},
            h('summary',null,h('span',{className:'kj-disclosure-label'},label),count!=null?h('span',{className:'kj-disclosure-count'},number(count)):null,h('span',{className:'kj-chevron','aria-hidden':true},chevron)),h('div',{className:'kj-detail'},children));
    }
    /**
     * @description Render managed sessions without navigation side effects or additional data requests.
     */
    function SchedulerSessionList({sessions, upcoming = false, openSession}) {
        const [opening, setOpening] = useState(null), [failure, setFailure] = useState(false);
        const [copied, setCopied] = useState(null);
        const copying = useRef(false);
        const copy = async id => {
            if (!id || copying.current) return;
            copying.current = true;
            try {await copySessionId(id);setCopied({id,ok:true});}
            catch {setCopied({id,ok:false});}
            finally {copying.current = false;}
        };
        const navigating = useRef(false);
        const open = async id => {
            if (!id || navigating.current) return;
            navigating.current = true; setOpening(id); setFailure(false);
            try { if (!await openSession?.(id)) throw Error("session-unavailable"); }
            catch {setFailure(true);}
            finally {navigating.current = false; setOpening(null);}
        };
        const [page, setPage] = useState(0);
        const pages = Math.max(1, Math.ceil(sessions.length / 3));
        const current = Math.min(page, pages - 1);
        useEffect(() => {setPage(old => Math.min(old, pages - 1));}, [pages]);
        const label = t(upcoming ? "即将接管的会话" : "接管中的会话");
        const phases = {active:"进行中",paused:"已暂停",completed:"已完成",blocked:"已阻塞"};
        const paths = {
            session:"M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 3-2Z",
            child:"M6 8v8m0-4h8a4 4 0 0 0 4-4M6 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
            upcoming:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2",
            paused:"M8 5v14M16 5v14",
            pausing:"M6 3h12M6 21h12M7 3v4l5 5-5 5v4M17 3v4l-5 5 5 5v4",
            info:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v6m0-10v.1",
            previous:"m14 6-6 6 6 6", next:"m10 6 6 6-6 6",
        };
        const icon = name => h("svg", {viewBox:"0 0 24 24", width:16, height:16, fill:"none", stroke:"currentColor", strokeWidth:1.7, strokeLinecap:"round", strokeLinejoin:"round", "aria-hidden":true}, h("path", {d:paths[name]}));
        const hintIcon = (name, text, onClick) => h("button", {type:"button", className:"kj-help kj-session-icon", "aria-label":text, "data-tooltip":text, onClick}, icon(name));
        return h("section", {className:"kj-session-status-list", "aria-label":label},
            h("strong", null, h(HelpLabel, {label:label + " · " + number(sessions.length), help:upcoming ? t("按当前运行状态预估；峰价到来时仍在执行的会话会被接管，之后新启动的任务同样受保护。") : null})),
            sessions.length ? h("ul", null, ...sessions.slice(current * 3, current * 3 + 3).map((item,index) =>
                h("li", {key:item.id || index},
                    h("div", {className:"kj-session-status-heading"},
                        hintIcon(item.parentId ? "child" : "session", copied?.id === item.id ? t(copied.ok ? "已复制 session ID，点击再次复制" : "复制失败，点击重试") : t(item.parentId ? "子代理：点击复制 session ID" : "点击复制 session ID"), ()=>copy(item.id)),
                        h("button", {type:"button", className:"kj-session-open", "data-tooltip":t("打开会话") + ": " + (item.title || t("未命名会话")), disabled:!!opening || !item.id, onClick:()=>open(item.id)}, item.title || t("未命名会话")),
                        hintIcon(opening === item.id ? "upcoming" : item.state, opening === item.id ? t("正在打开…") : t(item.state === "paused" ? "已暂停" : item.state === "upcoming" ? "待接管" : "等待安全暂停")),
                        hintIcon("info", [
                            "Session ID: " + (item.id || t("未知会话")),
                            item.goal ? "Goal: " + t(phases[item.goal.phase] || "未知") : "",
                            item.boundary ? t("暂停位置") + ": " + t(item.boundary === "request" ? "模型请求前" : "下一步骤前") : "",
                            item.parentId ? t("父会话") + ": " + item.parentId : "",
                        ].filter(Boolean).join(" · "))))))
                : h("p", null, t(upcoming ? "当前没有即将接管的活跃会话" : "当前没有被避险暂停的会话")),
            failure ? h("p", {role:"status"}, t("无法打开会话，请确认 DSH 已连接后重试")) : null,
            pages > 1 ? h("nav", {className:"kj-session-pagination", "aria-label":t("会话列表分页")},
                h("button", {type:"button", disabled:current === 0, onClick:()=>setPage(current - 1), "aria-label":t("上一页"), "data-tooltip":t("上一页")}, icon("previous")),
                h("span", {role:"status"}, number(current + 1) + " / " + number(pages)),
                h("button", {type:"button", disabled:current === pages - 1, onClick:()=>setPage(current + 1), "aria-label":t("下一页"), "data-tooltip":t("下一页")}, icon("next"))) : null);
    }
    return {SchedulerSessionList,TextField,SettingsTabs,SettingsSection,Nickname,HelpLabel,Disclosure,Select,SearchSelect,NumberField,Range,Skeleton,TooltipHost,beginRefresh,finishRefresh};
}

/**
 * @description Copy an exact session identity using the native bridge or browser clipboard.
 */
export async function copySessionId(id) {
    if(typeof id !== "string" || !id || id.length > 512 || /[\r\n\0]/.test(id))throw Error("invalid-session-id");
    if(globalThis.kujiraDesktop?.copySessionId)await globalThis.kujiraDesktop.copySessionId(id);
    else await navigator.clipboard.writeText(id);
}

/**
 * @description Normalize finite numeric settings to their range and decimal step precision.
 */
export function normalizeNumber(value, {min=0,max=Number.MAX_SAFE_INTEGER,step=1,integer=false} = {}) {
    if(typeof value!=="number" || !Number.isFinite(value))return null;
    const digits=integer?0:Math.min(6,Math.max(0,Math.ceil(-Math.log10(step))));
    return Math.min(max,Math.max(min,Number(value.toFixed(digits))));
}
