export default function PlaceholderPage({
  title,
  milestone,
}: {
  title: string;
  milestone: string;
}) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-slate-500">
          此功能属于里程碑 {milestone}，尚未开始开发。
        </p>
        <p className="mt-2 text-xs text-slate-400">
          开发计划见 docs/开发计划.md
        </p>
      </div>
    </div>
  );
}
