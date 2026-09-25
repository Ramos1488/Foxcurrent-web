# Foxurrent. — сайт на Vercel (общий онлайн-контент)

Чтобы **все посетители** видели проекты, блог, новости и команду, нужен бесплатный Supabase.

## 1. Supabase (5 минут)

1. Зайди на [supabase.com](https://supabase.com) → New project  
2. **SQL Editor** → New query → вставь весь файл `supabase-schema.sql` → Run  
3. **Project Settings → API**:
   - Project URL  
   - `anon` `public` key  
4. Открой `js/config.js` и вставь:

```js
window.FOXURRENT_CONFIG = {
  supabaseUrl: 'https://ТВОЙ_ПРОЕКТ.supabase.co',
  supabaseAnonKey: 'eyJ...'
};
```

## 2. Деплой на Vercel

1. Залей папку на GitHub  
2. [vercel.com](https://vercel.com) → Import project  
3. Framework Preset: **Other**  
4. Deploy  

Бейдж в шапке: **Online** = данные из Supabase, **Local** = только этот браузер.

## 3. Админ

Кнопка Admin → пароль (тот, что ты задал хешем в `js/app.js`).  
После входа добавляй игры / посты / команду — они сохраняются в облако и видны всем.

## Структура

```
index.html
js/config.js      ← URL и ключ Supabase
js/db.js          ← онлайн / local fallback
js/app.js
supabase-schema.sql
vercel.json
```

## Важно

- Без заполненного `config.js` сайт работает, но данные **локальные** (у каждого свои).  
- Политики RLS сейчас открыты на чтение/запись (как и клиентская админка). Для продакшена позже можно закрыть write и вынести API.
