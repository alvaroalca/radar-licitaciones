-- Lo que propuso el modelo, antes de depurar. Con esto los validadores se pueden afinar y
-- volver a aplicar (npm run revalidar) sin pasar otra vez los pliegos por la GPU.
-- Se aplica directamente, como 001 a 003.

alter table licitaciones.extracciones add column propuesta jsonb;
