export default function PIDocument() {
  return (
    <div className="min-h-screen bg-gray-100 p-8 flex justify-center">
      <div className="bg-white w-[210mm] min-h-[297mm] shadow-2xl p-12 relative text-center">
        <h1 className="text-4xl font-black text-gray-900 mt-20">🎉 恭喜！路由成功通车！</h1>
        <p className="text-xl text-gray-600 mt-8">如果您看到了这个页面，说明前面所有的 404 都是因为 Vercel 连不上 Supabase 数据库导致的崩溃闪退。</p>
        <p className="text-lg text-blue-600 mt-4">而不是您的文件建错了！</p>
      </div>
    </div>
  );
}
