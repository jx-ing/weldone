import React from 'react';

const EMPTY_INPUT='请输入';

function prompt({placeholder,title,value,defaultValue,readOnly}){
 const shown=value??defaultValue??'';
 return {
  placeholder:readOnly?placeholder:EMPTY_INPUT,
  title:title??(shown===''&&placeholder!==EMPTY_INPUT?placeholder:undefined)
 };
}

export function TextInput(props){
 return <input {...props} {...prompt(props)}/>;
}

export function TextArea(props){
 return <textarea {...props} {...prompt(props)}/>;
}
