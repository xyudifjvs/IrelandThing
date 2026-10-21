'use client';
import Link from 'next/link';
import {Settings} from '../../(workspace)/workspace/_components/Operations';
export default function Page(){return <main style={{maxWidth:1000,margin:'auto',padding:'40px 25px'}}><Link href="/portal" style={{fontSize:12,color:'#8c7251'}}>← Your portal</Link><div style={{marginTop:25}}><Settings/></div></main>;}
