package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/mysql"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jmoiron/sqlx"
	"github.com/rs/zerolog/log"
)

// DB wraps sqlx.DB with a helper for named queries
type DB struct {
	*sqlx.DB
}

func Connect(dsn string) (*DB, error) {
	db, err := sqlx.Connect("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}

	// Connection pool tuning
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)

	// Verify
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}

	log.Info().Msg("MySQL connected")
	return &DB{db}, nil
}

// Migrate opens a dedicated connection with multiStatements=true (required by
// golang-migrate for multi-statement SQL migration files) and runs all pending
// migrations. The main pool connection is NOT affected.
func Migrate(dsn string, migrationsPath string) error {
	// Append multiStatements=true so the migration driver can execute files
	// containing multiple SQL statements (MariaDB/MySQL requirement).
	migrateDSN := dsn
	if strings.Contains(dsn, "?") {
		migrateDSN += "&multiStatements=true"
	} else {
		migrateDSN += "?multiStatements=true"
	}

	mdb, err := sql.Open("mysql", migrateDSN)
	if err != nil {
		return fmt.Errorf("migration connection: %w", err)
	}
	defer mdb.Close()

	driver, err := mysql.WithInstance(mdb, &mysql.Config{})
	if err != nil {
		return fmt.Errorf("migration driver: %w", err)
	}

	m, err := migrate.NewWithDatabaseInstance(
		fmt.Sprintf("file://%s", migrationsPath),
		"mysql",
		driver,
	)
	if err != nil {
		return fmt.Errorf("migration init: %w", err)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migration up: %w", err)
	}

	version, _, _ := m.Version()
	log.Info().Uint("version", version).Msg("migrations applied")
	return nil
}

// Tx runs fn inside a transaction, rolling back on error.
func (db *DB) Tx(fn func(*sqlx.Tx) error) error {
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}
