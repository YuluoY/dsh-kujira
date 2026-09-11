export default {
 extends:['stylelint-config-standard'],
 rules:{
  'selector-class-pattern':'^(?:dsh-kujira|kj|is)-[a-z0-9-]+$|^[a-z][a-z0-9-]*$',
  'no-descending-specificity':null,
  'no-duplicate-selectors':null,
  'custom-property-empty-line-before':null,
  'declaration-empty-line-before':null,
  'rule-empty-line-before':null,
  'keyframes-name-pattern':'^kj-[a-z0-9-]+$'
 }
};
