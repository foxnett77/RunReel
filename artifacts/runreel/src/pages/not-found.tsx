import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="text-8xl font-black text-primary mb-4">404</div>
      <h1 className="text-2xl font-bold mb-2">Pagina non trovata</h1>
      <p className="text-muted-foreground mb-8">
        La pagina che cerchi non esiste o e stata spostata.
      </p>
      <Link href="/">
        <span className="px-6 py-3 bg-primary text-white rounded-lg font-semibold hover:bg-primary/90 transition-colors cursor-pointer">
          Torna alla home
        </span>
      </Link>
    </div>
  );
}
