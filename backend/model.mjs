const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export class CityState {
  constructor() { this.cities = new Map(); }
  ingest(patches, {replace = false, now = Date.now()} = {}) {
    if (!Array.isArray(patches)) return false;
    const previous = replace ? this.cities : null;
    if (replace) this.cities = new Map();
    let changed = replace;
    for (const patch of patches) {
      if (!patch || typeof patch !== 'object' || !Number.isSafeInteger(Number(patch.id)) || Number(patch.id) <= 0) continue;
      const id = Number(patch.id);
      let old = this.cities.get(id) || {id};
      if (replace) {
        const prior = previous.get(id);
        const battle = patch.nation_battle;
        // 完整清單仍移除缺席城市；只為持續交戰且沒有換場證據的城市保留欄位。
        const omitted = !own(patch, 'nation_battle');
        const valid = battle && typeof battle === 'object' && !Array.isArray(battle);
        const sameId = valid && battle.id != null && battle.id === prior?.battle?.id;
        const sameDeadline = !valid || battle.close_roll_call_at == null || prior?.battle?.close_roll_call_at == null || battle.close_roll_call_at === prior.battle.close_roll_call_at;
        if (prior && this.active(prior) && patch.sword === true &&
            (sameId || (sameDeadline && (omitted || (valid && !own(battle,'id')))))) old = prior;
      }
      const city = {...old};
      // 只保留網站需要的公開欄位，私人帳號與完整封包不儲存。
      if (typeof patch.name==='string') city.name=patch.name;
      if (typeof patch.sword==='boolean') city.sword=patch.sword;
      if (own(patch,'nation_battle_score') && (patch.nation_battle_score===null || ['number','string'].includes(typeof patch.nation_battle_score))) city.nation_battle_score=patch.nation_battle_score;
      if (typeof patch.control_nation?.name === 'string') city.nation = patch.control_nation.name;
      if (own(patch,'control_union')) {
        const union=patch.control_union;
        if (!union || typeof union!=='object' || Array.isArray(union)) {
          city.union_id=null;city.union_name=null;
        } else {
          if (own(union,'id')) {
            const id=Number(union.id);
            const next=Number.isSafeInteger(id)&&id>0?id:null;
            if(next!==city.union_id)city.union_name=null;
            city.union_id=next;
          }
          if (own(union,'name')) city.union_name=typeof union.name==='string'?union.name:null;
        }
      }
      if (own(patch, 'nation_battle')) {
        const battle = patch.nation_battle;
        if (!battle || typeof battle !== 'object' || Array.isArray(battle)) city.battle = null;
        else {
          const deadlineChanged = battle.close_roll_call_at != null && city.battle?.close_roll_call_at != null && battle.close_roll_call_at !== city.battle.close_roll_call_at;
          const same = battle.id != null ? battle.id === city.battle?.id : !own(battle,'id') && !deadlineChanged;
          if (!same) city.nation_battle_score = null;
          city.battle = same ? {...city.battle} : {};
          for (const key of ['id','close_roll_call_at','ended_at','finished_at','ended','finished'])
            if (own(battle,key) && (battle[key]===null || ['number','string','boolean'].includes(typeof battle[key]))) city.battle[key] = battle[key];
          // 僅保留已確認的公開陣營圖示路徑，不儲存任意網址或完整戰況封包。
          if (own(battle,'nation_icon')) city.battle.nation_icon =
            typeof battle.nation_icon==='string' && /^\/images\/nation\/color_icon\/minicoa\d{2}(CM|HK|MG|TB|KZ|UG|MC|TW|RB)\.png$/.test(battle.nation_icon)
              ? battle.nation_icon : null;
        }
        if (battle === null && !own(patch,'nation_battle_score')) city.nation_battle_score = null;
      }
      // 即使結束封包省略 battle，下次 sword:true 也不能沿用上一場的 ID。
      if (city.sword === false || city.battle?.ended_at || city.battle?.finished_at || city.battle?.ended || city.battle?.finished) {
        city.sword = false;
        city.battle = null;
        city.nation_battle_score = null;
      }
      if (JSON.stringify(old) !== JSON.stringify(city)) {
        city.observed_at = new Date(now).toISOString();
        this.cities.set(id, city); changed = true;
      } else if (replace) {
        this.cities.set(id, city);
      }
    }
    return changed;
  }
  active(city) {
    if (city.sword === false) return false;
    if (city.battle?.ended_at || city.battle?.finished_at || city.battle?.ended || city.battle?.finished) return false;
    if (city.sword === true) return true;
    return Boolean(city.nation_battle_score || city.battle?.id != null || city.battle?.close_roll_call_at);
  }
  rows({includeInactive=false}={}) {
    return [...this.cities.values()].filter(city => includeInactive || this.active(city)).map(city => ({
      city_id:city.id, name:city.name || `城市 ${city.id}`, control_nation_name:city.nation || '',
      control_union_id:city.union_id??null,control_union_name:city.union_name??null,
      updated_at:city.observed_at,
      // 全城市快照也保留已結束城市的控制權，但明確清除它的雙刀標記。
      nation_battle:this.active(city)?JSON.stringify({id:city.battle?.id,close_roll_call_at:city.battle?.close_roll_call_at,nation_icon:city.battle?.nation_icon,
        _rf_monitor:{active:true,score:city.nation_battle_score ?? null,observed_at:city.observed_at,source:'independent_backend'}}):null
    })).sort((a,b) => a.city_id-b.city_id);
  }
}
